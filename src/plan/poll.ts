import type { Collection, Decision, GroupId, MemberId, PlanId, PlanOption } from "../domain/types.js";
import { randomUUID } from "node:crypto";
import type { CoordinationRepository } from "../store/repository.js";
import { memoryRepository } from "../store/memory.js";
import type { OutgoingPollOption, Transport } from "../transport/types.js";

export interface PollConfig {
  question: string;
  options: PlanOption[];
  deadline?: string;
  targetMemberIds?: MemberId[];
}

export async function startPoll(
  groupId: GroupId,
  planId: PlanId,
  config: PollConfig,
  transport: Transport,
  repo: CoordinationRepository = memoryRepository
): Promise<Collection | undefined> {
  const pollId = await transport.sendPoll({
    groupId,
    question: config.question,
    options: config.options.map(toPollOption),
    deadline: config.deadline,
  });

  repo.setPlanOptions(groupId, planId, config.options);

  const collection = repo.createCollection(groupId, planId, {
    kind: "poll",
    prompt: config.question,
    targetMemberIds: config.targetMemberIds,
    visibility: "public",
    decisionRule: "majority",
    deadline: config.deadline,
    options: config.options,
    transportRef: { kind: "poll", id: pollId },
  });

  return collection;
}

export function tallyVotes(
  groupId: GroupId,
  planId: PlanId,
  repo: CoordinationRepository = memoryRepository
): { winner: PlanOption | undefined; tally: Map<string, number>; totalVotes: number } {
  const plan = repo.getPlan(groupId, planId);
  if (!plan) return { winner: undefined, tally: new Map(), totalVotes: 0 };

  const tally = new Map<string, number>();
  let totalVotes = 0;

  for (const option of plan.options) {
    tally.set(option.id, option.votes.length);
    totalVotes += option.votes.length;
  }

  const sorted = [...plan.options].sort((a, b) => b.votes.length - a.votes.length);
  const winner = sorted[0] && sorted[0].votes.length > 0 ? sorted[0] : undefined;

  return { winner, tally, totalVotes };
}

export function shouldClosePoll(
  groupId: GroupId,
  planId: PlanId,
  collectionId: string,
  repo: CoordinationRepository = memoryRepository
): boolean {
  const collection = repo.getCollection(groupId, planId, collectionId);
  if (!collection || collection.status !== "open") return false;

  const responded = collection.participants.filter((p) => p.status === "responded").length;
  const total = collection.participants.length;

  if (responded >= total) return true;

  if (collection.deadline) {
    const now = new Date();
    const deadline = new Date(collection.deadline);
    if (now >= deadline) return true;
  }

  if (total > 2 && responded >= Math.ceil(total * 0.75)) {
    const { winner, tally } = tallyVotes(groupId, planId);
    if (winner) {
      const winnerVotes = tally.get(winner.id) ?? 0;
      const remaining = total - responded;
      const secondPlace = [...tally.entries()]
        .filter(([id]) => id !== winner.id)
        .map(([, v]) => v)
        .sort((a, b) => b - a)[0] ?? 0;
      if (winnerVotes > secondPlace + remaining) return true;
    }
  }

  return false;
}

export async function closePollAndDecide(
  groupId: GroupId,
  planId: PlanId,
  collectionId: string,
  transport: Transport,
  repo: CoordinationRepository = memoryRepository
): Promise<Decision | undefined> {
  const collection = repo.getCollection(groupId, planId, collectionId);
  if (!collection) return undefined;

  const { winner, tally, totalVotes } = tallyVotes(groupId, planId, repo);
  if (!winner) {
    const text = "The poll closed but no clear winner emerged. Want to run another round or just pick one?";
    await transport.send({ groupId, text });
    repo.recordOutgoingMessage(groupId, text, planId);
    repo.closeCollection(groupId, planId, collectionId);
    return undefined;
  }

  const winnerVotes = tally.get(winner.id) ?? 0;
  const summary = `${winner.label} won ${winnerVotes}–${totalVotes - winnerVotes}.`;
  const plan = repo.getPlan(groupId, planId);
  const planDesc = plan?.description ?? "the plan";
  const text = `${summary} ${winner.details ? winner.details + "." : ""} What's the next step for ${planDesc}?`;

  await transport.send({ groupId, text });
  repo.recordOutgoingMessage(groupId, text, planId);

  repo.closeCollection(groupId, planId, collectionId);

  const decision: Decision = {
    selectedOptionId: winner.id,
    summary,
    decidedAt: new Date().toISOString(),
  };

  repo.recordDecision(groupId, planId, decision);

  return decision;
}

export function formatTally(
  groupId: GroupId,
  planId: PlanId,
  repo: CoordinationRepository = memoryRepository
): string {
  const plan = repo.getPlan(groupId, planId);
  if (!plan) return "No poll data.";

  if (plan.options.length === 0) return "No options set.";

  const lines = plan.options
    .sort((a, b) => b.votes.length - a.votes.length)
    .map((opt) => `• ${opt.label}: ${opt.votes.length} vote${opt.votes.length !== 1 ? "s" : ""}`);

  return lines.join("\n");
}

function toPollOption(option: PlanOption): OutgoingPollOption {
  return {
    id: option.id,
    label: option.label,
    description: option.details || undefined,
  };
}

export function createPlanOption(label: string, details: string): PlanOption {
  return { id: randomUUID(), label, details, votes: [] };
}
