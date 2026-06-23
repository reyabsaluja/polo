import type { GroupId, Message, Plan, PlanId } from "../domain/types.js";
import type { ParticipationRepository } from "../store/repository.js";

export type ParticipationState =
  | "mention_only"
  | "facilitating"
  | "waiting"
  | "quiet";

export interface GroupParticipation {
  groupId: GroupId;
  state: ParticipationState;
  activePlanId?: PlanId;
}

const participationStates = new Map<GroupId, GroupParticipation>();

function getParticipation(groupId: GroupId): GroupParticipation {
  const existing = participationStates.get(groupId);
  if (existing) return existing;

  const initial: GroupParticipation = { groupId, state: "mention_only" };
  participationStates.set(groupId, initial);
  return initial;
}

function setParticipation(groupId: GroupId, state: ParticipationState, activePlanId?: PlanId): void {
  participationStates.set(groupId, { groupId, state, activePlanId });
}

function resetParticipation(): void {
  participationStates.clear();
}

export function shouldRespond(
  message: Message,
  activePlan: Plan | undefined,
  participation?: GroupParticipation
): boolean {
  const state = participation ?? getParticipation(message.groupId);

  if (message.mentionsPolo) return true;

  switch (state.state) {
    case "mention_only":
      return false;
    case "facilitating":
      return isRelevantToPlan(message, activePlan);
    case "waiting":
      return hasOpenQuestion(activePlan);
    case "quiet":
      return false;
  }
}

function isRelevantToPlan(message: Message, plan: Plan | undefined): boolean {
  if (!plan) return false;
  const text = message.text.toLowerCase();
  const repliesToPlanContext = Boolean(
    message.replyTo && plan.routes.some((route) => route.kind === "message" && route.value === message.replyTo)
  );
  if (repliesToPlanContext) {
    return hasPlanningSignal(text) || isShortPlanningAnswer(text);
  }

  const planTerms = extractPlanTerms(plan);
  const mentionsPlan = planTerms.some((term) => text.includes(term));
  const hasOpenCollection = plan.collections.some((collection) => collection.status === "open");
  if (!mentionsPlan && !(hasOpenCollection && hasPlanningSignal(text))) return false;

  return hasPlanningSignal(text) || isShortPlanningAnswer(text);
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
    terms.push(...words.filter(isUsefulPlanTerm));
  }
  for (const option of plan.options) {
    terms.push(...option.label.toLowerCase().split(/\s+/).filter(isUsefulPlanTerm));
    terms.push(...option.details.toLowerCase().split(/\s+/).filter(isUsefulPlanTerm));
  }
  for (const collection of plan.collections) {
    if (collection.status === "open") {
      terms.push(...collection.prompt.toLowerCase().split(/\s+/).filter(isUsefulPlanTerm));
    }
  }
  return terms;
}

function hasPlanningSignal(text: string): boolean {
  return /\b(yes|yeah|yep|no|works|available|free|can't|cannot|can|prefer|vote|rsvp|under|\$\d+|after|before|around|at \d|\d(:\d\d)?|vegetarian|vegan|gluten|halal|kosher)\b/i.test(
    text
  );
}

function isShortPlanningAnswer(text: string): boolean {
  return /^(yes|yeah|yep|no|nah|sure|works|done|in|out)$/i.test(text.trim());
}

const STOP_WORDS = new Set([
  "this", "that", "with", "from", "what", "when", "where", "plan",
  "some", "will", "just", "have", "been", "like", "they", "them",
  "would", "could", "should", "about", "there", "their", "which",
  "dinner", "lunch", "place", "options", "restaurant", "event",
  "group", "everyone", "something", "anything",
]);

function isUsefulPlanTerm(word: string): boolean {
  const cleaned = word.replace(/[^a-z0-9$]/g, "");
  if (cleaned.length <= 4) return false;
  return !STOP_WORDS.has(cleaned);
}

export const participationRepository: ParticipationRepository = {
  getParticipation,
  setParticipation,
  resetParticipation,
};
