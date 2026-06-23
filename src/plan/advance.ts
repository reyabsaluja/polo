import type { GroupId, Plan, PlanId, PlanPhase } from "../domain/types.js";
import { memoryRepository } from "../store/memory.js";
import { participationRepository } from "../governor/participation.js";

export interface PhaseTransition {
  from: PlanPhase;
  to: PlanPhase;
  reason: string;
}

export function evaluatePhaseAdvancement(groupId: GroupId, planId: PlanId): PhaseTransition | undefined {
  const plan = memoryRepository.getPlan(groupId, planId);
  if (!plan) return undefined;

  switch (plan.phase) {
    case "gathering_intent":
      return checkGatheringToCollecting(plan);
    case "collecting_constraints":
      return checkCollectingToFinding(plan);
    case "finding_options":
      return checkFindingToPolling(plan);
    case "polling":
      return checkPollingToDecided(plan);
    case "decided":
      return checkDecidedToFollowThrough(plan);
    case "following_through":
      return checkFollowThroughToComplete(plan);
    case "complete":
      return undefined;
  }
}

export function advancePlan(groupId: GroupId, planId: PlanId): PhaseTransition | undefined {
  const transition = evaluatePhaseAdvancement(groupId, planId);
  if (!transition) return undefined;

  memoryRepository.updatePlanPhase(groupId, planId, transition.to);

  if (transition.to === "complete") {
    participationRepository.setParticipation(groupId, "quiet");
  }

  return transition;
}

function checkGatheringToCollecting(plan: Plan): PhaseTransition | undefined {
  if (plan.constraints.length > 0 || plan.interestedMembers.length > 0) {
    return { from: "gathering_intent", to: "collecting_constraints", reason: "constraints identified" };
  }
  return undefined;
}

function checkCollectingToFinding(plan: Plan): PhaseTransition | undefined {
  const activeConstraints = plan.constraints.filter((c) => c.status === "active");
  const types = new Set(activeConstraints.map((c) => c.type));
  const hasOpenInput = plan.expectedInputs.some((i) => i.status === "open");

  if (hasOpenInput) return undefined;

  const hasMinimumConstraints = types.size >= 3;
  const hasDateOrTime = types.has("date") || types.has("time");
  const hasVenueHint = types.has("location") || types.has("preference") || types.has("budget");

  if (hasMinimumConstraints && hasDateOrTime && hasVenueHint) {
    return { from: "collecting_constraints", to: "finding_options", reason: "sufficient constraints gathered" };
  }

  return undefined;
}

function checkFindingToPolling(plan: Plan): PhaseTransition | undefined {
  if (plan.options.length >= 2) {
    return { from: "finding_options", to: "polling", reason: "options ready for group vote" };
  }
  return undefined;
}

function checkPollingToDecided(plan: Plan): PhaseTransition | undefined {
  if (plan.decision) {
    return { from: "polling", to: "decided", reason: "poll resolved" };
  }
  return undefined;
}

function checkDecidedToFollowThrough(plan: Plan): PhaseTransition | undefined {
  if (plan.commitments.length > 0) {
    return { from: "decided", to: "following_through", reason: "commitments assigned" };
  }
  return undefined;
}

function checkFollowThroughToComplete(plan: Plan): PhaseTransition | undefined {
  if (plan.commitments.length === 0) return undefined;
  const allDone = plan.commitments.every((c) => c.completed);
  if (allDone) {
    return { from: "following_through", to: "complete", reason: "all commitments fulfilled" };
  }
  return undefined;
}

export function getReadinessReport(groupId: GroupId, planId: PlanId): string {
  const plan = memoryRepository.getPlan(groupId, planId);
  if (!plan) return "No plan found.";

  const active = plan.constraints.filter((c) => c.status === "active");
  const types = new Set(active.map((c) => c.type));

  const have: string[] = [];
  const need: string[] = [];

  for (const type of ["date", "time", "location", "budget", "dietary"] as const) {
    if (types.has(type)) {
      const values = active.filter((c) => c.type === type).map((c) => c.value);
      have.push(`${type}: ${values.join(", ")}`);
    } else {
      if (type === "date" || type === "time" || type === "location") {
        need.push(type);
      }
    }
  }

  const lines = [`Plan: "${plan.description}" (${plan.phase})`];
  if (have.length) lines.push(`Have: ${have.join("; ")}`);
  if (need.length) lines.push(`Still need: ${need.join(", ")}`);
  lines.push(`Interested: ${plan.interestedMembers.length} members`);
  if (plan.options.length) lines.push(`Options: ${plan.options.length}`);
  if (plan.decision) lines.push(`Decision: ${plan.decision.summary}`);

  return lines.join("\n");
}
