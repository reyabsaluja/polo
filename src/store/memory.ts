import type {
  Commitment,
  Collection,
  CollectionKind,
  Constraint,
  ConstraintScope,
  ConstraintType,
  CreateCollectionInput,
  Decision,
  ExpectedInput,
  Group,
  GroupEvent,
  GroupId,
  Member,
  MemberId,
  Message,
  MessageId,
  Plan,
  PlanId,
  PlanOption,
  PlanPhase,
  PlanRoute,
  PlanRouteKind,
  PlanRoutingHints,
  PrivateContext,
} from "../domain/types.js";
import { randomUUID } from "crypto";
import { messageScope } from "../privacy/context.js";
import type { CoordinationRepository } from "./repository.js";

interface GroupStore {
  group: Group;
  plans: Map<PlanId, Plan>;
  messages: Message[];
  privateContexts: PrivateContext[];
  messageIds: Set<MessageId>;
  events: GroupEvent[];
  sharedMemory: Map<string, string>;
}

const groups = new Map<GroupId, GroupStore>();

function createGroup(id: GroupId, name: string, members: Member[]): Group {
  const group: Group = { id, name, members, createdAt: new Date().toISOString() };
  groups.set(id, {
    group,
    plans: new Map(),
    messages: [],
    privateContexts: [],
    messageIds: new Set(),
    events: [],
    sharedMemory: new Map(),
  });
  return group;
}

function resetMemory(): void {
  groups.clear();
}

function getGroup(id: GroupId): Group | undefined {
  return groups.get(id)?.group;
}

function getMember(groupId: GroupId, memberId: MemberId): Member | undefined {
  return groups.get(groupId)?.group.members.find((m) => m.id === memberId);
}

function storeMessage(message: Message): boolean {
  const store = groups.get(message.groupId);
  if (!store) return false;
  if (store.messageIds.has(message.id)) return false;

  store.messageIds.add(message.id);
  const scope = messageScope(message);
  if (scope === "shared") {
    store.messages.push(message);
  } else {
    store.privateContexts.push({
      id: randomUUID(),
      groupId: message.groupId,
      memberId: message.senderId,
      messageId: message.id,
      scope,
      text: message.text,
      capturedAt: new Date().toISOString(),
    });
  }

  appendGroupEvent(message.groupId, {
    type: "message.received",
    actorId: message.senderId,
    messageId: message.id,
    summary: scope === "shared" ? "Message received" : "Private message received",
    payload: scope === "shared"
      ? { text: message.text, scope }
      : { scope, redacted: true },
  });
  return true;
}

function getRecentMessages(groupId: GroupId, count: number): Message[] {
  const store = groups.get(groupId);
  if (!store) return [];
  return store.messages.slice(-count);
}

function getPrivateContexts(groupId: GroupId, memberId?: MemberId): PrivateContext[] {
  const contexts = groups.get(groupId)?.privateContexts ?? [];
  return contexts.filter((context) => !memberId || context.memberId === memberId);
}

function createPlan(groupId: GroupId, description: string): Plan {
  const plan: Plan = {
    id: randomUUID(),
    groupId,
    phase: "gathering_intent",
    description,
    constraints: [],
    interestedMembers: [],
    options: [],
    expectedInputs: [],
    collections: [],
    routes: [],
    commitments: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const store = groups.get(groupId);
  if (store) {
    store.plans.set(plan.id, plan);
    appendGroupEvent(groupId, {
      type: "plan.created",
      planId: plan.id,
      summary: `Plan created: ${description}`,
      payload: { description },
    });
  }
  return plan;
}

function getActivePlan(groupId: GroupId): Plan | undefined {
  const store = groups.get(groupId);
  if (!store) return undefined;
  return getOpenPlansByUpdatedAt(store)[0];
}

function getPlan(groupId: GroupId, planId: PlanId): Plan | undefined {
  return groups.get(groupId)?.plans.get(planId);
}

function getRoutablePlan(groupId: GroupId, routing?: PlanRoutingHints): Plan | undefined {
  const store = groups.get(groupId);
  if (!store) return undefined;

  const routed = findPlanByRoute(store, routing);
  if (routed) return routed;

  if (routing?.preferredPlanId) {
    const preferred = getPlan(groupId, routing.preferredPlanId);
    if (preferred && isOpenPlan(preferred)) return preferred;
  }

  return getActivePlan(groupId);
}

function addPlanRoute(
  groupId: GroupId,
  planId: PlanId,
  kind: PlanRouteKind,
  value: string,
  sourceMessageId?: MessageId
): PlanRoute | undefined {
  const plan = groups.get(groupId)?.plans.get(planId);
  if (!plan) return undefined;

  const route = addPlanRouteInternal(plan, kind, value, sourceMessageId);
  if (!route) return undefined;

  appendGroupEvent(groupId, {
    type: "plan.route_added",
    planId,
    messageId: sourceMessageId,
    summary: `Plan route added: ${kind}`,
    payload: { route },
  });
  return route;
}

function createCollection(
  groupId: GroupId,
  planId: PlanId,
  input: CreateCollectionInput
): Collection | undefined {
  const store = groups.get(groupId);
  const plan = store?.plans.get(planId);
  if (!store || !plan) return undefined;

  const now = new Date().toISOString();
  const targetMemberIds = input.targetMemberIds ?? store.group.members.map((member) => member.id);
  const collection: Collection = {
    id: randomUUID(),
    groupId,
    planId,
    kind: input.kind,
    prompt: input.prompt,
    status: "open",
    visibility: input.visibility ?? "public",
    decisionRule: input.decisionRule,
    deadline: input.deadline,
    participants: targetMemberIds.map((memberId) => ({ memberId, status: "pending" })),
    responses: [],
    options: input.options,
    transportRef: input.transportRef,
    createdAt: now,
    updatedAt: now,
  };

  plan.collections.push(collection);
  plan.updatedAt = now;
  if (collection.transportRef) {
    addRouteForTransportRef(groupId, planId, collection.transportRef);
  }
  appendGroupEvent(groupId, {
    type: "collection.created",
    planId,
    summary: `Collection opened: ${input.kind}`,
    payload: { collection },
  });
  return collection;
}

function getCollection(
  groupId: GroupId,
  planId: PlanId,
  collectionId: string
): Collection | undefined {
  return groups.get(groupId)?.plans.get(planId)?.collections.find((collection) => collection.id === collectionId);
}

function getOpenCollections(groupId: GroupId, planId: PlanId, kind?: CollectionKind): Collection[] {
  const collections = groups.get(groupId)?.plans.get(planId)?.collections ?? [];
  return collections.filter((collection) => collection.status === "open" && (!kind || collection.kind === kind));
}

function linkCollectionTransportRef(
  groupId: GroupId,
  planId: PlanId,
  collectionId: string,
  kind: "message" | "poll" | "card",
  id: string
): void {
  const collection = getCollection(groupId, planId, collectionId);
  if (!collection) return;
  collection.transportRef = { kind, id };
  collection.updatedAt = new Date().toISOString();
  addRouteForTransportRef(groupId, planId, collection.transportRef);
}

function recordCollectionResponse(
  groupId: GroupId,
  planId: PlanId,
  collectionId: string,
  memberId: MemberId,
  value: string,
  sourceMessageId?: MessageId,
  scope: ConstraintScope = "shared"
): void {
  const collection = getCollection(groupId, planId, collectionId);
  if (!collection || collection.status !== "open") return;

  const now = new Date().toISOString();
  const existing = collection.responses.find((response) => response.memberId === memberId);
  if (existing) {
    existing.value = value;
    existing.scope = scope;
    existing.capturedAt = now;
    existing.sourceMessageId = sourceMessageId;
  } else {
    collection.responses.push({
      id: randomUUID(),
      memberId,
      value,
      scope,
      capturedAt: now,
      sourceMessageId,
    });
  }

  const participant = collection.participants.find((candidate) => candidate.memberId === memberId);
  if (participant) {
    participant.status = "responded";
    participant.respondedAt = now;
  } else {
    collection.participants.push({ memberId, status: "responded", respondedAt: now });
  }

  collection.updatedAt = now;
  groups.get(groupId)!.plans.get(planId)!.updatedAt = now;
  appendGroupEvent(groupId, {
    type: "collection.response_recorded",
    actorId: memberId,
    planId,
    messageId: sourceMessageId,
    summary: `Collection response recorded: ${collection.kind}`,
    payload: { collectionId, memberId, scope },
  });
}

function closeCollection(groupId: GroupId, planId: PlanId, collectionId: string): void {
  const collection = getCollection(groupId, planId, collectionId);
  if (!collection || collection.status !== "open") return;

  const now = new Date().toISOString();
  collection.status = "closed";
  collection.updatedAt = now;
  groups.get(groupId)!.plans.get(planId)!.updatedAt = now;
  appendGroupEvent(groupId, {
    type: "collection.closed",
    planId,
    summary: `Collection closed: ${collection.kind}`,
    payload: { collectionId },
  });
}

function isOpenPlan(plan: Plan): boolean {
  return plan.phase !== "complete";
}

function getOpenPlansByUpdatedAt(store: GroupStore): Plan[] {
  return [...store.plans.values()]
    .filter(isOpenPlan)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

function findPlanByRoute(store: GroupStore, routing?: PlanRoutingHints): Plan | undefined {
  if (!routing) return undefined;

  const routeValues: Array<[PlanRouteKind, string | undefined]> = [
    ["message", routing.replyTo],
    ["poll", routing.pollId],
    ["card", routing.cardId],
    ["thread", routing.threadId],
  ];

  for (const plan of getOpenPlansByUpdatedAt(store)) {
    for (const [kind, value] of routeValues) {
      if (value && plan.routes.some((route) => route.kind === kind && route.value === value)) {
        return plan;
      }
    }
  }

  return undefined;
}

function addPlanRouteInternal(
  plan: Plan,
  kind: PlanRouteKind,
  value: string,
  sourceMessageId?: MessageId
): PlanRoute | undefined {
  if (plan.routes.some((route) => route.kind === kind && route.value === value)) return undefined;

  const route: PlanRoute = {
    id: randomUUID(),
    kind,
    value,
    createdAt: new Date().toISOString(),
    sourceMessageId,
  };
  plan.routes.push(route);
  plan.updatedAt = new Date().toISOString();
  return route;
}

function addRouteForTransportRef(
  groupId: GroupId,
  planId: PlanId,
  transportRef: { kind: "message" | "poll" | "card"; id: string }
): void {
  addPlanRoute(groupId, planId, transportRef.kind, transportRef.id);
}

function findPollCollection(plan: Plan, pollId?: string): Collection | undefined {
  if (pollId) {
    const linked = plan.collections.find(
      (collection) =>
        collection.kind === "poll" &&
        collection.status === "open" &&
        collection.transportRef?.kind === "poll" &&
        collection.transportRef.id === pollId
    );
    if (linked) return linked;
  }

  return plan.collections.find((collection) => collection.kind === "poll" && collection.status === "open");
}

function updatePlanPhase(groupId: GroupId, planId: PlanId, phase: PlanPhase): void {
  const plan = groups.get(groupId)?.plans.get(planId);
  if (plan) {
    plan.phase = phase;
    plan.updatedAt = new Date().toISOString();
    appendGroupEvent(groupId, {
      type: "plan.phase_updated",
      planId,
      summary: `Plan phase updated to ${phase}`,
      payload: { phase },
    });
  }
}

function getOpenExpectedInput(groupId: GroupId, planId: PlanId): ExpectedInput | undefined {
  const plan = groups.get(groupId)?.plans.get(planId);
  return plan?.expectedInputs.find((input) => input.status === "open");
}

function setOpenConstraintInput(
  groupId: GroupId,
  planId: PlanId,
  constraintType: ConstraintType,
  prompt: string,
  requestedByMessageId: MessageId
): ExpectedInput | undefined {
  const plan = groups.get(groupId)?.plans.get(planId);
  if (!plan) return undefined;

  for (const input of plan.expectedInputs) {
    if (input.status === "open") input.status = "cancelled";
  }
  for (const collection of plan.collections) {
    if (collection.kind === "constraint" && collection.status === "open") {
      collection.status = "cancelled";
      collection.updatedAt = new Date().toISOString();
    }
  }

  const input: ExpectedInput = {
    id: randomUUID(),
    kind: "constraint",
    constraintType,
    prompt,
    requestedAt: new Date().toISOString(),
    requestedByMessageId,
    status: "open",
  };

  plan.expectedInputs.push(input);
  plan.updatedAt = new Date().toISOString();
  appendGroupEvent(groupId, {
    type: "expected_input.opened",
    planId,
    messageId: requestedByMessageId,
    summary: `Waiting for ${constraintType}`,
    payload: { inputId: input.id, constraintType, prompt },
  });
  createCollection(groupId, planId, {
    kind: "constraint",
    prompt,
    visibility: "public",
    transportRef: { kind: "message", id: requestedByMessageId },
  });
  return input;
}

function satisfyExpectedInput(
  groupId: GroupId,
  planId: PlanId,
  inputId: string,
  messageId: MessageId
): void {
  const plan = groups.get(groupId)?.plans.get(planId);
  const input = plan?.expectedInputs.find((candidate) => candidate.id === inputId);
  if (!plan || !input) return;

  input.status = "satisfied";
  input.satisfiedByMessageId = messageId;
  plan.updatedAt = new Date().toISOString();
  appendGroupEvent(groupId, {
    type: "expected_input.satisfied",
    planId,
    messageId,
    summary: `Expected ${input.constraintType} input satisfied`,
    payload: { inputId, constraintType: input.constraintType },
  });
}

function addConstraint(groupId: GroupId, planId: PlanId, constraint: Constraint): void {
  const plan = groups.get(groupId)?.plans.get(planId);
  if (plan) {
    const existing = plan.constraints.findIndex(
      (c) =>
        c.type === constraint.type &&
        c.value === constraint.value &&
        c.sourceMessageId === constraint.sourceMessageId
    );
    if (existing >= 0) {
      const previous = plan.constraints[existing]!;
      plan.constraints[existing] = {
        ...constraint,
        id: previous.id,
        capturedAt: previous.capturedAt,
        status: previous.status,
      };
    } else {
      for (const prior of plan.constraints) {
        if (
          prior.status === "active" &&
          prior.type === constraint.type &&
          prior.source === constraint.source &&
          prior.value !== constraint.value
        ) {
          prior.status = "superseded";
        }
      }
      plan.constraints.push(constraint);
      addPlanRoute(groupId, plan.id, "message", constraint.sourceMessageId, constraint.sourceMessageId);
      appendGroupEvent(groupId, {
        type: "constraint.recorded",
        actorId: constraint.source,
        planId,
        messageId: constraint.sourceMessageId,
        summary: `Constraint recorded: ${constraint.type}=${constraint.value}`,
        payload: { constraint },
      });
    }
    plan.updatedAt = new Date().toISOString();
  }
}

function addInterestedMember(groupId: GroupId, planId: PlanId, memberId: MemberId): void {
  const plan = groups.get(groupId)?.plans.get(planId);
  if (plan && !plan.interestedMembers.includes(memberId)) {
    plan.interestedMembers.push(memberId);
    plan.updatedAt = new Date().toISOString();
  }
}

function setPlanOptions(groupId: GroupId, planId: PlanId, options: PlanOption[]): void {
  const plan = groups.get(groupId)?.plans.get(planId);
  if (plan) {
    plan.options = options;
    plan.updatedAt = new Date().toISOString();
  }
}

function recordVote(
  groupId: GroupId,
  planId: PlanId,
  optionId: string,
  memberId: MemberId,
  pollId?: string
): void {
  const plan = groups.get(groupId)?.plans.get(planId);
  if (!plan) return;
  const option = plan.options.find((o) => o.id === optionId);
  if (option) {
    for (const candidate of plan.options) {
      candidate.votes = candidate.votes.filter((vote) => vote !== memberId);
    }
    option.votes.push(memberId);
    plan.updatedAt = new Date().toISOString();

    const pollCollection = findPollCollection(plan, pollId);
    if (pollCollection) {
      recordCollectionResponse(groupId, planId, pollCollection.id, memberId, optionId);
    }
    if (pollId) {
      addPlanRoute(groupId, planId, "poll", pollId);
    }
    appendGroupEvent(groupId, {
      type: "poll.vote_recorded",
      actorId: memberId,
      planId,
      summary: `Vote recorded: ${optionId}`,
      payload: { optionId, pollId },
    });
  }
}

function recordDecision(groupId: GroupId, planId: PlanId, decision: Decision): void {
  const plan = groups.get(groupId)?.plans.get(planId);
  if (plan) {
    plan.decision = decision;
    plan.updatedAt = new Date().toISOString();
    appendGroupEvent(groupId, {
      type: "decision.recorded",
      planId,
      summary: decision.summary,
      payload: { decision },
    });
    updatePlanPhase(groupId, planId, "decided");
  }
}

function addCommitment(groupId: GroupId, planId: PlanId, commitment: Commitment): void {
  const plan = groups.get(groupId)?.plans.get(planId);
  if (plan) {
    plan.commitments.push(commitment);
    plan.updatedAt = new Date().toISOString();
    appendGroupEvent(groupId, {
      type: "commitment.recorded",
      actorId: commitment.memberId,
      planId,
      summary: commitment.action,
      payload: { commitment },
    });
  }
}

function saveSharedMemory(groupId: GroupId, key: string, value: string): void {
  const store = groups.get(groupId);
  if (store) store.sharedMemory.set(key, value);
}

function getSharedMemory(groupId: GroupId, key: string): string | undefined {
  return groups.get(groupId)?.sharedMemory.get(key);
}

function recordOutgoingMessage(groupId: GroupId, text: string, planId?: PlanId, messageId?: MessageId): void {
  appendGroupEvent(groupId, {
    type: "message.sent",
    planId,
    messageId,
    summary: "Polo sent a group message",
    payload: { text },
  });
}

function getGroupEvents(groupId: GroupId): GroupEvent[] {
  return [...(groups.get(groupId)?.events ?? [])];
}

function appendGroupEvent(
  groupId: GroupId,
  event: Omit<GroupEvent, "id" | "groupId" | "occurredAt">
): GroupEvent | undefined {
  const store = groups.get(groupId);
  if (!store) return undefined;

  const storedEvent: GroupEvent = {
    id: randomUUID(),
    groupId,
    occurredAt: new Date().toISOString(),
    ...event,
  };
  store.events.push(storedEvent);
  return storedEvent;
}

export const memoryRepository: CoordinationRepository = {
  createGroup,
  resetMemory,
  getGroup,
  getMember,
  storeMessage,
  getRecentMessages,
  getPrivateContexts,
  createPlan,
  getActivePlan,
  getPlan,
  getRoutablePlan,
  addPlanRoute,
  createCollection,
  getCollection,
  getOpenCollections,
  linkCollectionTransportRef,
  recordCollectionResponse,
  closeCollection,
  updatePlanPhase,
  getOpenExpectedInput,
  setOpenConstraintInput,
  satisfyExpectedInput,
  addConstraint,
  addInterestedMember,
  setPlanOptions,
  recordVote,
  recordDecision,
  addCommitment,
  saveSharedMemory,
  getSharedMemory,
  recordOutgoingMessage,
  getGroupEvents,
};
