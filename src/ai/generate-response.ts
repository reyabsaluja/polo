import type { Constraint, Group, Member, Message, Plan } from "../domain/types.js";
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

  const conversationText = recentMessages
    .map((m) => `${memberMap.get(m.senderId) ?? m.senderId}: ${m.text}`)
    .join("\n");

  const constraintSummary = extractedConstraints?.length
    ? extractedConstraints
        .map((c) => `- ${c.type}: ${c.value} (from ${memberMap.get(c.source) ?? c.source})`)
        .join("\n")
    : "None extracted yet.";

  const missingInfoText = missingInfo?.length
    ? missingInfo.join(", ")
    : "Nothing obvious missing.";

  const planContext = plan
    ? `Active plan: "${plan.description}" (phase: ${plan.phase})\nInterested: ${plan.interestedMembers.map((id) => memberMap.get(id) ?? id).join(", ") || "TBD"}`
    : "No active plan.";

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

Constraints I've extracted:
${constraintSummary}

Key missing info: ${missingInfoText}

${senderName} triggered me with: "${triggerMessage.text}"

Generate my response. Keep it to 1-3 sentences. Be warm but efficient.`,
      },
    ],
  });

  const text = response.content[0]?.type === "text" ? response.content[0].text : "";
  return text.trim();
}
