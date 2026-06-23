import type { GroupId, Message, Plan } from "../domain/types.js";

export type ParticipationState =
  | "dormant"
  | "mention_only"
  | "facilitating"
  | "waiting"
  | "commitment_watch"
  | "quiet";

export interface GroupParticipation {
  groupId: GroupId;
  state: ParticipationState;
  activePlanId?: string;
}

const participationStates = new Map<GroupId, GroupParticipation>();

export function getParticipation(groupId: GroupId): GroupParticipation {
  const existing = participationStates.get(groupId);
  if (existing) return existing;

  const initial: GroupParticipation = { groupId, state: "mention_only" };
  participationStates.set(groupId, initial);
  return initial;
}

export function setParticipation(groupId: GroupId, state: ParticipationState, activePlanId?: string): void {
  participationStates.set(groupId, { groupId, state, activePlanId });
}

export function resetParticipation(): void {
  participationStates.clear();
}

export function shouldRespond(message: Message, activePlan: Plan | undefined): boolean {
  const participation = getParticipation(message.groupId);

  if (message.mentionsPolo) return true;

  switch (participation.state) {
    case "dormant":
      return false;
    case "mention_only":
      return false;
    case "facilitating":
      return isRelevantToPlan(message, activePlan);
    case "waiting":
      return hasOpenQuestion(activePlan);
    case "commitment_watch":
      return false;
    case "quiet":
      return false;
  }
}

function isRelevantToPlan(message: Message, plan: Plan | undefined): boolean {
  if (!plan) return false;
  const text = message.text.toLowerCase();
  const planTerms = extractPlanTerms(plan);
  const mentionsPlan = planTerms.some((term) => text.includes(term));
  if (!mentionsPlan) return false;

  return /\b(yes|no|works|available|can't|cannot|prefer|under|\$\d+|after|before|around|at \d|vegetarian|vegan|gluten|halal|kosher)\b/i.test(
    message.text
  );
}

function hasOpenQuestion(plan: Plan | undefined): boolean {
  if (!plan) return false;
  return plan.expectedInputs.some((input) => input.status === "open");
}

function extractPlanTerms(plan: Plan): string[] {
  const terms: string[] = [];
  for (const c of plan.constraints) {
    terms.push(c.value.toLowerCase());
  }
  if (plan.description) {
    const words = plan.description.toLowerCase().split(/\s+/);
    terms.push(...words.filter((w) => w.length > 3));
  }
  return terms;
}
