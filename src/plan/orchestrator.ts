import type { Constraint, ConstraintType, MemberId, Message, Plan } from "../domain/types.js";
import { isMockMode } from "../ai/client.js";
import { extractConstraints } from "../ai/extract-constraints.js";
import { findOptions, mockFindOptions } from "../ai/find-options.js";
import { generateResponse } from "../ai/generate-response.js";
import { mockExtractConstraints, mockGenerateResponse } from "../ai/mock.js";
import { participationRepository, shouldRespond } from "../governor/participation.js";
import { isGroupSafeMessage } from "../privacy/context.js";
import { memoryRepository } from "../store/memory.js";
import type { InboundTransportEvent, Transport } from "../transport/types.js";
import { advancePlan } from "./advance.js";
import { closePollAndDecide, shouldClosePoll, startPoll } from "./poll.js";

export interface PoloResponse {
  text: string;
  newPlan?: Plan;
  phaseAdvanced?: boolean;
}

interface Extraction {
  constraints: Constraint[];
  planDescription: string;
  interestedMembers: MemberId[];
  missingInfo: string[];
}

export async function handleTransportEvent(
  event: InboundTransportEvent,
  transport: Transport
): Promise<PoloResponse | null> {
  switch (event.kind) {
    case "message":
      return handleMessage(event.message, transport);
    case "poll_vote":
      return handlePollVote(event.vote, transport);
    case "reaction":
      return null;
  }
}

async function handlePollVote(
  vote: InboundTransportEvent & { kind: "poll_vote" } extends { vote: infer V } ? V : never,
  transport: Transport
): Promise<PoloResponse | null> {
  memoryRepository.recordVote(
    vote.groupId,
    vote.planId,
    vote.optionId,
    vote.voterId,
    vote.pollId
  );

  const plan = memoryRepository.getPlan(vote.groupId, vote.planId);
  if (!plan) return null;

  const pollCollections = memoryRepository.getOpenCollections(vote.groupId, vote.planId, "poll");
  for (const collection of pollCollections) {
    if (shouldClosePoll(vote.groupId, vote.planId, collection.id)) {
      const decision = await closePollAndDecide(vote.groupId, vote.planId, collection.id, transport);
      if (decision) {
        advancePlan(vote.groupId, vote.planId);
        return { text: decision.summary, phaseAdvanced: true };
      }
    }
  }

  return null;
}

export async function handleMessage(message: Message, transport: Transport): Promise<PoloResponse | null> {
  const wasStored = memoryRepository.storeMessage(message);
  if (!wasStored) return null;

  const group = memoryRepository.getGroup(message.groupId);
  if (!group) return null;

  if (!isGroupSafeMessage(message)) {
    return null;
  }

  const participation = participationRepository.getParticipation(message.groupId);
  const activePlan = memoryRepository.getRoutablePlan(message.groupId, {
    preferredPlanId: participation.activePlanId,
    replyTo: message.replyTo,
  });
  const expectedInput = activePlan ? memoryRepository.getOpenExpectedInput(message.groupId, activePlan.id) : undefined;

  if (!shouldRespond(message, activePlan)) {
    return null;
  }

  const recentMessages = memoryRepository.getRecentMessages(message.groupId, 20);

  let extraction: Extraction;
  if (isMockMode()) {
    extraction = mockExtractConstraints(recentMessages, group.members);
  } else {
    extraction = await extractConstraints(recentMessages, group.members);
  }

  if (participation.state === "waiting" && activePlan && expectedInput) {
    const satisfiedConstraint = extraction.constraints.find(
      (constraint) =>
        constraint.type === expectedInput.constraintType && constraint.source === message.senderId
    );
    const satisfied = Boolean(satisfiedConstraint);

    if (!satisfied && !message.mentionsPolo) {
      return null;
    }

    if (satisfied && satisfiedConstraint) {
      memoryRepository.satisfyExpectedInput(message.groupId, activePlan.id, expectedInput.id, message.id);
      const collection = memoryRepository.getOpenCollections(message.groupId, activePlan.id, "constraint")[0];
      if (collection) {
        memoryRepository.recordCollectionResponse(
          message.groupId,
          activePlan.id,
          collection.id,
          message.senderId,
          satisfiedConstraint.value,
          message.id,
          satisfiedConstraint.scope
        );
        memoryRepository.closeCollection(message.groupId, activePlan.id, collection.id);
      }
    }
  }

  let plan = activePlan;
  if (!plan && extraction.constraints.length > 0) {
    plan = memoryRepository.createPlan(message.groupId, extraction.planDescription);
    memoryRepository.addPlanRoute(message.groupId, plan.id, "message", message.id, message.id);
    participationRepository.setParticipation(message.groupId, "facilitating", plan.id);
  }

  if (plan) {
    for (const constraint of extraction.constraints) {
      memoryRepository.addConstraint(message.groupId, plan.id, constraint);
    }
    for (const memberId of extraction.interestedMembers) {
      memoryRepository.addInterestedMember(message.groupId, plan.id, memberId);
    }

  }

  if (plan) {
    let transition = advancePlan(message.groupId, plan.id);
    while (transition) {
      if (transition.to === "finding_options") {
        return await handleFindOptions(message.groupId, plan, transport);
      }
      transition = advancePlan(message.groupId, plan.id);
    }
  }

  let response: string;
  if (isMockMode()) {
    response = mockGenerateResponse(extraction.constraints, extraction.missingInfo, group.members);
  } else {
    response = await generateResponse({
      group,
      plan,
      recentMessages,
      extractedConstraints: extraction.constraints,
      missingInfo: extraction.missingInfo,
      triggerMessage: message,
    });
  }

  if (!response) {
    return null;
  }

  await transport.send({ groupId: message.groupId, text: response });
  memoryRepository.recordOutgoingMessage(message.groupId, response, plan?.id, message.id);

  if (plan) {
    const nextExpectedType = expectedConstraintType(extraction.missingInfo[0]);
    if (nextExpectedType) {
      memoryRepository.setOpenConstraintInput(message.groupId, plan.id, nextExpectedType, response, message.id);
      participationRepository.setParticipation(message.groupId, "waiting", plan.id);
    } else {
      participationRepository.setParticipation(message.groupId, "facilitating", plan.id);
    }
  }

  return { text: response, newPlan: plan && !activePlan ? plan : undefined };
}

async function handleFindOptions(
  groupId: string,
  plan: Plan,
  transport: Transport
): Promise<PoloResponse> {
  const group = memoryRepository.getGroup(groupId)!;

  const result = isMockMode()
    ? mockFindOptions(plan, group)
    : await findOptions(plan, group);

  if (result.options.length === 0) {
    const text = "I couldn't find options matching all constraints. Could you relax the budget or location?";
    await transport.send({ groupId, text });
    memoryRepository.updatePlanPhase(groupId, plan.id, "collecting_constraints");
    participationRepository.setParticipation(groupId, "facilitating", plan.id);
    return { text, phaseAdvanced: false };
  }

  const question = `Here are three options for ${plan.description}. Vote for your pick:`;

  await startPoll(groupId, plan.id, {
    question,
    options: result.options,
    targetMemberIds: plan.interestedMembers.length > 0 ? plan.interestedMembers : undefined,
  }, transport);

  advancePlan(groupId, plan.id);
  participationRepository.setParticipation(groupId, "waiting", plan.id);
  return { text: question, phaseAdvanced: true };
}

function expectedConstraintType(missingInfo: string | undefined): ConstraintType | undefined {
  if (!missingInfo) return undefined;
  const normalized = missingInfo.toLowerCase();
  if (normalized.includes("budget") || normalized.includes("price")) return "budget";
  if (normalized.includes("time")) return "time";
  if (normalized.includes("area") || normalized.includes("neighborhood") || normalized.includes("location")) {
    return "location";
  }
  if (normalized.includes("date") || normalized.includes("day")) return "date";
  if (normalized.includes("diet")) return "dietary";
  if (normalized.includes("who") || normalized.includes("attendance")) return "attendance";
  return undefined;
}
