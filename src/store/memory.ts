import type {
  Commitment,
  Constraint,
  ConstraintType,
  Decision,
  ExpectedInput,
  Group,
  GroupId,
  Member,
  MemberId,
  Message,
  MessageId,
  Plan,
  PlanId,
  PlanOption,
  PlanPhase,
} from "../domain/types.js";
import { randomUUID } from "crypto";

interface GroupStore {
  group: Group;
  plans: Map<PlanId, Plan>;
  messages: Message[];
  sharedMemory: Map<string, string>;
}

const groups = new Map<GroupId, GroupStore>();

export function createGroup(id: GroupId, name: string, members: Member[]): Group {
  const group: Group = { id, name, members, createdAt: new Date().toISOString() };
  groups.set(id, { group, plans: new Map(), messages: [], sharedMemory: new Map() });
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

export function storeMessage(message: Message): void {
  const store = groups.get(message.groupId);
  if (store) store.messages.push(message);
}

export function getRecentMessages(groupId: GroupId, count: number): Message[] {
  const store = groups.get(groupId);
  if (!store) return [];
  return store.messages.slice(-count);
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
  if (store) store.plans.set(plan.id, plan);
  return plan;
}

export function getActivePlan(groupId: GroupId): Plan | undefined {
  const store = groups.get(groupId);
  if (!store) return undefined;
  for (const plan of store.plans.values()) {
    if (plan.phase !== "complete") return plan;
  }
  return undefined;
}

export function getPlan(groupId: GroupId, planId: PlanId): Plan | undefined {
  return groups.get(groupId)?.plans.get(planId);
}

export function updatePlanPhase(groupId: GroupId, planId: PlanId, phase: PlanPhase): void {
  const plan = groups.get(groupId)?.plans.get(planId);
  if (plan) {
    plan.phase = phase;
    plan.updatedAt = new Date().toISOString();
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
}

export function addConstraint(groupId: GroupId, planId: PlanId, constraint: Constraint): void {
  const plan = groups.get(groupId)?.plans.get(planId);
  if (plan) {
    const existing = plan.constraints.findIndex(
      (c) => c.type === constraint.type && c.source === constraint.source
    );
    if (existing >= 0) {
      plan.constraints[existing] = constraint;
    } else {
      plan.constraints.push(constraint);
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
  }
}

export function addCommitment(groupId: GroupId, planId: PlanId, commitment: Commitment): void {
  const plan = groups.get(groupId)?.plans.get(planId);
  if (plan) {
    plan.commitments.push(commitment);
    plan.updatedAt = new Date().toISOString();
  }
}

export function saveSharedMemory(groupId: GroupId, key: string, value: string): void {
  const store = groups.get(groupId);
  if (store) store.sharedMemory.set(key, value);
}

export function getSharedMemory(groupId: GroupId, key: string): string | undefined {
  return groups.get(groupId)?.sharedMemory.get(key);
}
