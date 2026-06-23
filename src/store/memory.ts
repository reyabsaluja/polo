import type {
  Commitment,
  Constraint,
  ConstraintType,
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

export function createGroup(id: GroupId, name: string, members: Member[]): Group {
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

export function resetMemory(): void {
  groups.clear();
}

export function getGroup(id: GroupId): Group | undefined {
  return groups.get(id)?.group;
}

export function getMember(groupId: GroupId, memberId: MemberId): Member | undefined {
  return groups.get(groupId)?.group.members.find((m) => m.id === memberId);
}

export function storeMessage(message: Message): boolean {
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

export function getRecentMessages(groupId: GroupId, count: number): Message[] {
  const store = groups.get(groupId);
  if (!store) return [];
  return store.messages.slice(-count);
}

export function getPrivateContexts(groupId: GroupId, memberId?: MemberId): PrivateContext[] {
  const contexts = groups.get(groupId)?.privateContexts ?? [];
  return contexts.filter((context) => !memberId || context.memberId === memberId);
}

export function createPlan(groupId: GroupId, description: string): Plan {
  const plan: Plan = {
    id: randomUUID(),
    groupId,
    phase: "gathering_intent",
    description,
    constraints: [],
    interestedMembers: [],
    options: [],
    expectedInputs: [],
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

export function getActivePlan(groupId: GroupId): Plan | undefined {
  const store = groups.get(groupId);
  if (!store) return undefined;
  for (const plan of store.plans.values()) {
    if (isOpenPlan(plan)) return plan;
  }
  return undefined;
}

export function getPlan(groupId: GroupId, planId: PlanId): Plan | undefined {
  return groups.get(groupId)?.plans.get(planId);
}

export function getRoutablePlan(groupId: GroupId, preferredPlanId?: PlanId): Plan | undefined {
  if (preferredPlanId) {
    const preferred = getPlan(groupId, preferredPlanId);
    if (preferred && isOpenPlan(preferred)) return preferred;
  }

  return getActivePlan(groupId);
}

function isOpenPlan(plan: Plan): boolean {
  return plan.phase !== "decided" && plan.phase !== "complete";
}

export function updatePlanPhase(groupId: GroupId, planId: PlanId, phase: PlanPhase): void {
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

export function getOpenExpectedInput(groupId: GroupId, planId: PlanId): ExpectedInput | undefined {
  const plan = groups.get(groupId)?.plans.get(planId);
  return plan?.expectedInputs.find((input) => input.status === "open");
}

export function setOpenConstraintInput(
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
  return input;
}

export function satisfyExpectedInput(
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

export function addConstraint(groupId: GroupId, planId: PlanId, constraint: Constraint): void {
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

export function addInterestedMember(groupId: GroupId, planId: PlanId, memberId: MemberId): void {
  const plan = groups.get(groupId)?.plans.get(planId);
  if (plan && !plan.interestedMembers.includes(memberId)) {
    plan.interestedMembers.push(memberId);
    plan.updatedAt = new Date().toISOString();
  }
}

export function setPlanOptions(groupId: GroupId, planId: PlanId, options: PlanOption[]): void {
  const plan = groups.get(groupId)?.plans.get(planId);
  if (plan) {
    plan.options = options;
    plan.updatedAt = new Date().toISOString();
  }
}

export function recordVote(groupId: GroupId, planId: PlanId, optionId: string, memberId: MemberId): void {
  const plan = groups.get(groupId)?.plans.get(planId);
  if (!plan) return;
  const option = plan.options.find((o) => o.id === optionId);
  if (option && !option.votes.includes(memberId)) {
    option.votes.push(memberId);
    plan.updatedAt = new Date().toISOString();
  }
}

export function recordDecision(groupId: GroupId, planId: PlanId, decision: Decision): void {
  const plan = groups.get(groupId)?.plans.get(planId);
  if (plan) {
    plan.decision = decision;
    plan.phase = "decided";
    plan.updatedAt = new Date().toISOString();
    appendGroupEvent(groupId, {
      type: "decision.recorded",
      planId,
      summary: decision.summary,
      payload: { decision },
    });
  }
}

export function addCommitment(groupId: GroupId, planId: PlanId, commitment: Commitment): void {
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

export function saveSharedMemory(groupId: GroupId, key: string, value: string): void {
  const store = groups.get(groupId);
  if (store) store.sharedMemory.set(key, value);
}

export function getSharedMemory(groupId: GroupId, key: string): string | undefined {
  return groups.get(groupId)?.sharedMemory.get(key);
}

export function recordOutgoingMessage(groupId: GroupId, text: string, planId?: PlanId, messageId?: MessageId): void {
  appendGroupEvent(groupId, {
    type: "message.sent",
    planId,
    messageId,
    summary: "Polo sent a group message",
    payload: { text },
  });
}

export function getGroupEvents(groupId: GroupId): GroupEvent[] {
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
