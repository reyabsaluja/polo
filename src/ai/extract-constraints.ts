import type { Constraint, Member, MemberId, Message } from "../domain/types.js";
import { getClient } from "./client.js";

interface ExtractionResult {
  constraints: Constraint[];
  planDescription: string;
  interestedMembers: MemberId[];
  missingInfo: string[];
}

export async function extractConstraints(
  messages: Message[],
  members: Member[]
): Promise<ExtractionResult> {
  const memberMap = new Map(members.map((m) => [m.id, m.name]));

  const conversationText = messages
    .map((m) => `${memberMap.get(m.senderId) ?? m.senderId}: ${m.text}`)
    .join("\n");

  const memberList = members.map((m) => `- ${m.name} (id: ${m.id})`).join("\n");

  const response = await getClient().messages.create({
    model: "claude-sonnet-4-6-20250514",
    max_tokens: 1024,
    messages: [
      {
        role: "user",
        content: `You are analyzing a group chat conversation to extract planning constraints. The group members are:
${memberList}

Conversation:
${conversationText}

Extract the following as JSON:
{
  "planDescription": "brief description of what the group is planning",
  "constraints": [
    {
      "type": "date" | "time" | "location" | "budget" | "dietary" | "attendance" | "preference",
      "value": "the constraint value as stated",
      "source": "member_id who stated this",
      "confidence": 0.0 to 1.0
    }
  ],
  "interestedMembers": ["member_ids of people who seem interested/participating"],
  "missingInfo": ["list of important unknowns the group hasn't settled yet"]
}

Rules:
- Only extract constraints that were explicitly stated or strongly implied
- Confidence should reflect how clearly the constraint was stated
- missingInfo should list the 1-2 most important gaps (budget? time? location?)
- Do NOT invent constraints that weren't mentioned
- If someone seems interested based on their participation, include them

Return ONLY the JSON, no other text.`,
      },
    ],
  });

  const text = response.content[0]?.type === "text" ? response.content[0].text : "";

  try {
    const parsed = JSON.parse(text);
    return {
      planDescription: parsed.planDescription ?? "group plan",
      constraints: (parsed.constraints ?? []).map((c: Record<string, unknown>) => ({
        type: c.type as Constraint["type"],
        value: String(c.value),
        source: String(c.source),
        confidence: Number(c.confidence) || 0.5,
      })),
      interestedMembers: parsed.interestedMembers ?? [],
      missingInfo: parsed.missingInfo ?? [],
    };
  } catch {
    return {
      planDescription: "group plan",
      constraints: [],
      interestedMembers: [],
      missingInfo: ["Could not parse constraints from conversation"],
    };
  }
}
