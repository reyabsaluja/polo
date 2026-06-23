import type { Collection, GroupId, MemberId, PlanId } from "../domain/types.js";
import type { CoordinationRepository } from "../store/repository.js";
import { memoryRepository } from "../store/memory.js";
import type { Transport } from "../transport/types.js";

export interface TimeSlot {
  day: string;
  start: string;
  end: string;
}

export interface AvailabilityResult {
  sharedSlots: TimeSlot[];
  respondedCount: number;
  totalCount: number;
}

export async function startAvailabilityCollection(
  groupId: GroupId,
  planId: PlanId,
  prompt: string,
  targetMemberIds: MemberId[],
  transport: Transport,
  repo: CoordinationRepository = memoryRepository
): Promise<Collection | undefined> {
  const collection = repo.createCollection(groupId, planId, {
    kind: "availability",
    prompt,
    targetMemberIds,
    visibility: "private",
  });

  if (!collection) return undefined;

  await transport.send({
    groupId,
    text: prompt,
  });

  for (const memberId of targetMemberIds) {
    await transport.sendPrivate({
      groupId,
      recipientId: memberId,
      text: `For the group plan: when are you free? Reply with your available times (e.g. "Saturday 6-9pm" or "Sunday afternoon"). Your specific schedule stays private — I'll only share the overlapping windows.`,
    });
  }

  return collection;
}

export function recordAvailability(
  groupId: GroupId,
  planId: PlanId,
  collectionId: string,
  memberId: MemberId,
  rawAvailability: string,
  messageId?: string,
  repo: CoordinationRepository = memoryRepository
): void {
  repo.recordCollectionResponse(
    groupId,
    planId,
    collectionId,
    memberId,
    rawAvailability,
    messageId,
    "private"
  );
}

export function computeSharedAvailability(
  groupId: GroupId,
  planId: PlanId,
  collectionId: string,
  repo: CoordinationRepository = memoryRepository
): AvailabilityResult {
  const collection = repo.getCollection(groupId, planId, collectionId);
  if (!collection) {
    return { sharedSlots: [], respondedCount: 0, totalCount: 0 };
  }

  const responded = collection.participants.filter((p) => p.status === "responded");
  const total = collection.participants.length;

  const slots = findOverlappingSlots(collection.responses.map((r) => r.value));

  return {
    sharedSlots: slots,
    respondedCount: responded.length,
    totalCount: total,
  };
}

function findOverlappingSlots(responses: string[]): TimeSlot[] {
  if (responses.length === 0) return [];

  const allSlots = responses.map(parseAvailabilityText);
  if (allSlots.length === 0) return [];

  let intersected = allSlots[0]!;
  for (let i = 1; i < allSlots.length; i++) {
    intersected = intersectSlotSets(intersected, allSlots[i]!);
    if (intersected.length === 0) return [];
  }

  return intersected;
}

function intersectSlotSets(setA: TimeSlot[], setB: TimeSlot[]): TimeSlot[] {
  const result: TimeSlot[] = [];
  for (const a of setA) {
    for (const b of setB) {
      if (a.day !== b.day) continue;
      const start = a.start > b.start ? a.start : b.start;
      const end = a.end < b.end ? a.end : b.end;
      if (start < end) {
        result.push({ day: a.day, start, end });
      }
    }
  }
  return result;
}

function parseAvailabilityText(text: string): TimeSlot[] {
  const slots: TimeSlot[] = [];
  const lines = text.split(/[,;\n]+/).map((l) => l.trim()).filter(Boolean);

  for (const line of lines) {
    const slot = parseSlotLine(line);
    if (slot) slots.push(slot);
  }

  return slots;
}

const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const TIME_RANGE_RE = /(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\s*[-–to]+\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/i;
const PERIOD_RE = /\b(morning|afternoon|evening|night)\b/i;

function parseSlotLine(line: string): TimeSlot | null {
  const lower = line.toLowerCase();
  const day = DAYS.find((d) => lower.includes(d)) ?? inferDay(lower);
  if (!day) return null;

  const timeMatch = lower.match(TIME_RANGE_RE);
  if (timeMatch) {
    return { day, start: normalizeTime(timeMatch[1]!), end: normalizeTime(timeMatch[2]!) };
  }

  const periodMatch = lower.match(PERIOD_RE);
  if (periodMatch) {
    const { start, end } = periodToTimes(periodMatch[1]!.toLowerCase());
    return { day, start, end };
  }

  if (/\bfree\b|\bavailable\b|\bworks\b|\bopen\b/.test(lower)) {
    return { day, start: "09:00", end: "23:00" };
  }

  return null;
}

function inferDay(text: string): string | null {
  if (/\btoday\b/.test(text)) return "today";
  if (/\btomorrow\b/.test(text)) return "tomorrow";
  if (/\bweekend\b/.test(text)) return "saturday";
  return null;
}

function periodToTimes(period: string): { start: string; end: string } {
  switch (period) {
    case "morning": return { start: "08:00", end: "12:00" };
    case "afternoon": return { start: "12:00", end: "17:00" };
    case "evening": return { start: "17:00", end: "21:00" };
    case "night": return { start: "19:00", end: "23:00" };
    default: return { start: "09:00", end: "23:00" };
  }
}

function normalizeTime(raw: string): string {
  const trimmed = raw.trim().toLowerCase();
  const hourMatch = trimmed.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (!hourMatch) return trimmed;

  let hour = parseInt(hourMatch[1]!, 10);
  const minutes = hourMatch[2] ?? "00";
  const meridiem = hourMatch[3];

  if (meridiem === "pm" && hour < 12) hour += 12;
  if (meridiem === "am" && hour === 12) hour = 0;

  return `${hour.toString().padStart(2, "0")}:${minutes}`;
}


export function formatSharedAvailability(result: AvailabilityResult): string {
  if (result.sharedSlots.length === 0) {
    if (result.respondedCount < result.totalCount) {
      return `${result.respondedCount} of ${result.totalCount} people have shared availability. Waiting for more responses.`;
    }
    return "No overlapping times found. The group may need to revisit scheduling.";
  }

  const formatted = result.sharedSlots
    .map((slot) => `${capitalize(slot.day)} ${slot.start}–${slot.end}`)
    .join("\n• ");

  return `Everyone can make:\n• ${formatted}`;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
