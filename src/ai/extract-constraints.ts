import type { Constraint, ConstraintType, Member, MemberId, Message } from "../domain/types.js";
import { randomUUID } from "node:crypto";
import { formatMessagesForPrompt, groupSafeMessages } from "../privacy/context.js";
import { getClient } from "./client.js";

export interface ExtractionResult {
  constraints: Constraint[];
  planDescription: string;
  interestedMembers: MemberId[];
  missingInfo: string[];
}

const constraintTypes = new Set<ConstraintType>([
  "date",
  "time",
  "location",
  "budget",
  "dietary",
  "attendance",
  "preference",
]);

export async function extractConstraints(
  messages: Message[],
  members: Member[]
): Promise<ExtractionResult> {
  const safeMessages = groupSafeMessages(messages);
  const conversationText = formatMessagesForPrompt(safeMessages, members);

  const memberList = members.map((m) => `- ${m.name} (id: ${m.id})`).join("\n");

  let text: string;
  try {
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
      "sourceMessageId": "message_id where this was stated",
      "confidence": 0.0 to 1.0
    }
  ],
  "interestedMembers": ["member_ids of people who seem interested/participating"],
  "missingInfo": ["list of important unknowns the group hasn't settled yet"]
}

Rules:
- Only extract constraints that were explicitly stated or strongly implied
- Confidence should reflect how clearly the constraint was stated
- sourceMessageId must be the exact message_id where the constraint was stated
- missingInfo should list the 1-2 most important gaps (budget? time? location?)
- Do NOT invent constraints that weren't mentioned
- If someone seems interested based on their participation, include them

Return ONLY the JSON, no other text.`,
        },
      ],
    });
    text = response.content[0]?.type === "text" ? response.content[0].text : "";
  } catch {
    return {
      planDescription: "group plan",
      constraints: [],
      interestedMembers: [],
      missingInfo: ["Could not reach AI service"],
    };
  }

  const capturedAt = new Date().toISOString();

  return parseExtractionJson(text, safeMessages, members, capturedAt);
}

export function parseExtractionJson(
  text: string,
  safeMessages: Message[],
  members: Member[],
  capturedAt = new Date().toISOString()
): ExtractionResult {
  const memberIds = new Set(members.map((member) => member.id));

  try {
    const parsed = JSON.parse(extractJsonObject(text));
    return {
      planDescription: stringOrDefault(parsed.planDescription, "group plan"),
      constraints: normalizeConstraints(parsed.constraints, safeMessages, memberIds, capturedAt),
      interestedMembers: normalizeMemberIds(parsed.interestedMembers, memberIds),
      missingInfo: normalizeStringList(parsed.missingInfo).slice(0, 2),
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

function normalizeConstraints(
  candidates: unknown,
  messages: Message[],
  memberIds: Set<MemberId>,
  capturedAt: string
): Constraint[] {
  if (!Array.isArray(candidates)) return [];

  return candidates.flatMap((candidate) => {
    if (!isRecord(candidate)) return [];

    const type = normalizeConstraintType(candidate.type);
    const value = stringOrDefault(candidate.value, "").trim();
    const source = stringOrDefault(candidate.source, "");
    const sourceMessageId = resolveSourceMessageId(candidate, messages, source);

    if (!type || !value || !memberIds.has(source) || !sourceMessageId) return [];

    return [{
      type,
      value,
      source,
      sourceMessageId,
      confidence: normalizeConfidence(candidate.confidence),
      id: randomUUID(),
      status: "active",
      scope: "shared",
      capturedAt,
    }];
  });
}

function normalizeConstraintType(value: unknown): ConstraintType | undefined {
  if (typeof value !== "string") return undefined;
  return constraintTypes.has(value as ConstraintType) ? value as ConstraintType : undefined;
}

function resolveSourceMessageId(
  candidate: Record<string, unknown>,
  messages: Message[],
  source: MemberId
): string | undefined {
  const claimed = String(candidate.sourceMessageId ?? "");
  if (messages.some((message) => message.id === claimed && message.senderId === source)) return claimed;

  const value = String(candidate.value ?? "").toLowerCase();
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message?.senderId === source && value && message.text.toLowerCase().includes(value)) {
      return message.id;
    }
  }

  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message?.senderId === source) return message.id;
  }

  return undefined;
}

function normalizeMemberIds(candidates: unknown, memberIds: Set<MemberId>): MemberId[] {
  const unique = new Set<MemberId>();
  for (const memberId of normalizeStringList(candidates)) {
    if (memberIds.has(memberId)) unique.add(memberId);
  }
  return [...unique];
}

function normalizeStringList(candidates: unknown): string[] {
  if (!Array.isArray(candidates)) return [];
  return candidates.flatMap((candidate) => {
    if (typeof candidate !== "string") return [];
    const trimmed = candidate.trim();
    return trimmed ? [trimmed] : [];
  });
}

function normalizeConfidence(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0.5;
  return Math.max(0, Math.min(1, numeric));
}

function stringOrDefault(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function extractJsonObject(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) return trimmed;

  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) return trimmed.slice(start, end + 1);

  return trimmed;
}
