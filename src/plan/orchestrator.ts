import type { Constraint, ConstraintType, MemberId, Message, Plan } from "../domain/types.js";
import { isMockMode } from "../ai/client.js";
import { extractConstraints } from "../ai/extract-constraints.js";
import { generateResponse } from "../ai/generate-response.js";
import { mockExtractConstraints, mockGenerateResponse } from "../ai/mock.js";
import { getParticipation, shouldRespond, setParticipation } from "../governor/participation.js";
import { isGroupSafeMessage } from "../privacy/context.js";
import {
  getGroup,
  getRoutablePlan,
  createPlan,
  storeMessage,
  getRecentMessages,
  addConstraint,
  addInterestedMember,
  updatePlanPhase,
  getOpenExpectedInput,
  satisfyExpectedInput,
  setOpenConstraintInput,
} from "../store/memory.js";
import type { Transport } from "../transport/types.js";

export interface PoloResponse {
  text: string;
  newPlan?: Plan;
}

interface Extraction {
  constraints: Constraint[];
  planDescription: string;
  interestedMembers: MemberId[];
  missingInfo: string[];
}

export async function handleMessage(message: Message, transport: Transport): Promise<PoloResponse | null> {
  storeMessage(message);

  const group = getGroup(message.groupId);
  if (!group) return null;

  if (!isGroupSafeMessage(message)) {
    return null;
  }

  const participation = getParticipation(message.groupId);
  const activePlan = getRoutablePlan(message.groupId, participation.activePlanId);
  const expectedInput = activePlan ? getOpenExpectedInput(message.groupId, activePlan.id) : undefined;

  if (!shouldRespond(message, activePlan)) {
    return null;
  }

  const recentMessages = getRecentMessages(message.groupId, 20);

  let extraction: Extraction;
  if (isMockMode()) {
    extraction = mockExtractConstraints(recentMessages, group.members);
  } else {
    extraction = await extractConstraints(recentMessages, group.members);
  }

  if (participation.state === "waiting" && activePlan && expectedInput) {
    const satisfied = extraction.constraints.some(
      (constraint) =>
        constraint.type === expectedInput.constraintType && constraint.source === message.senderId
    );

    if (!satisfied && !message.mentionsPolo) {
      return null;
    }

    if (satisfied) {
      satisfyExpectedInput(message.groupId, activePlan.id, expectedInput.id, message.id);
    }
  }

  let plan = activePlan;
  if (!plan && extraction.constraints.length > 0) {
    plan = createPlan(message.groupId, extraction.planDescription);
    setParticipation(message.groupId, "facilitating", plan.id);
  }

  if (plan) {
    for (const constraint of extraction.constraints) {
      addConstraint(message.groupId, plan.id, constraint);
    }
    for (const memberId of extraction.interestedMembers) {
      addInterestedMember(message.groupId, plan.id, memberId);
    }

    if (plan.phase === "gathering_intent" && extraction.constraints.length > 0) {
      updatePlanPhase(message.groupId, plan.id, "collecting_constraints");
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

  await transport.send({ groupId: message.groupId, text: response });

  if (plan) {
    const nextExpectedType = expectedConstraintType(extraction.missingInfo[0]);
    if (nextExpectedType) {
      setOpenConstraintInput(message.groupId, plan.id, nextExpectedType, response, message.id);
      setParticipation(message.groupId, "waiting", plan.id);
    } else {
      setParticipation(message.groupId, "facilitating", plan.id);
    }
  }

  return { text: response, newPlan: plan && !activePlan ? plan : undefined };
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
