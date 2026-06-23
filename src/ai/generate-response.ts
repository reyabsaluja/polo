import type { Constraint, Group, Member, Message, Plan } from "../domain/types.js";
import { formatConstraintsForPrompt, formatMessagesForPrompt, formatTriggerForPrompt } from "../privacy/context.js";
import { getClient } from "./client.js";

interface ResponseContext {
  group: Group;
  plan: Plan | undefined;
  recentMessages: Message[];
  extractedConstraints?: Constraint[];
  missingInfo?: string[];
  triggerMessage: Message;
}

export async function generateResponse(context: ResponseContext): Promise<string> {
  const { group, plan, recentMessages, extractedConstraints, missingInfo, triggerMessage } = context;

  const memberMap = new Map(group.members.map((m: Member) => [m.id, m.name]));
  const senderName = memberMap.get(triggerMessage.senderId) ?? "someone";

  const conversationText = formatMessagesForPrompt(recentMessages, group.members);

  const newConstraintSummary = extractedConstraints?.length
    ? formatConstraintsForPrompt(extractedConstraints, group.members)
    : "None extracted yet.";

  const missingInfoText = missingInfo?.length
    ? missingInfo.join(", ")
    : "Nothing obvious missing.";

  const planContext = plan ? formatPlanContextForPrompt(plan, group.members) : "No active plan.";

  const response = await getClient().messages.create({
    model: "claude-sonnet-4-6-20250514",
    max_tokens: 300,
    system: `You are Polo, a group coordination AI in a friend group chat. Your personality:
- Warm, concise, calm, capable
- Socially perceptive — you know when to speak and when to be quiet
- Direct when action is needed
- NEVER verbose. Group chat messages should be SHORT (1-3 sentences max)
- You ask only the ONE most important missing question, not five

Rules:
- Summarize what you already know from the conversation
- Ask only for the single most critical missing piece
- Never repeat what people already said
- Use their names naturally
- Don't announce your capabilities — just help
- If someone says "help" or asks you directly, respond to THEIR specific situation
- Frame responses as easy to answer (yes/no, pick from options, give a number)`,
    messages: [
      {
        role: "user",
        content: `Group: "${group.name}" (${group.members.map((m) => m.name).join(", ")})
${planContext}

Recent conversation:
${conversationText}

New constraints from this turn:
${newConstraintSummary}

Key missing info: ${missingInfoText}

${senderName} triggered me with: "${formatTriggerForPrompt(triggerMessage)}"

Generate my response. Keep it to 1-3 sentences. Be warm but efficient.`,
      },
    ],
  });

  const text = response.content[0]?.type === "text" ? response.content[0].text : "";
  return text.trim();
}

export function formatPlanContextForPrompt(plan: Plan, members: Member[]): string {
  const memberMap = new Map(members.map((member) => [member.id, member.name]));
  const knownConstraints = formatConstraintsForPrompt(plan.constraints, members);
  const interested = plan.interestedMembers.map((id) => memberMap.get(id) ?? id).join(", ") || "TBD";
  const options = plan.options.length
    ? plan.options.map((option) => `- ${option.label}: ${option.details} (${option.votes.length} votes)`).join("\n")
    : "None yet.";
  const openCollections = plan.collections.filter((collection) => collection.status === "open");
  const collectionText = openCollections.length
    ? openCollections
        .map((collection) => {
          const responded = collection.participants.filter((participant) => participant.status === "responded").length;
          return `- ${collection.kind}: ${collection.prompt} (${responded}/${collection.participants.length} responded)`;
        })
        .join("\n")
    : "None.";
  const decisionText = plan.decision ? plan.decision.summary : "None yet.";

  return `Active plan: "${plan.description}" (phase: ${plan.phase})
Interested: ${interested}
Known constraints:
${knownConstraints}
Options:
${options}
Open collections:
${collectionText}
Decision: ${decisionText}`;
}
