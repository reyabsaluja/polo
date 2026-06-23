import type { Constraint, Member, MemberId, Message } from "../domain/types.js";

interface ExtractionResult {
  constraints: Constraint[];
  planDescription: string;
  interestedMembers: MemberId[];
  missingInfo: string[];
}

export function mockExtractConstraints(
  messages: Message[],
  _members: Member[]
): ExtractionResult {
  const constraints: Constraint[] = [];
  const interested: Set<MemberId> = new Set();

  for (const msg of messages) {
    const text = msg.text.toLowerCase();
    interested.add(msg.senderId);

    if (/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/.test(text)) {
      const day = text.match(/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/)?.[1];
      if (day) constraints.push({ type: "date", value: day, source: msg.senderId, confidence: 0.9 });
    }

    if (/\b(downtown|midtown|uptown|east side|west side)\b/.test(text)) {
      const loc = text.match(/\b(downtown|midtown|uptown|east side|west side)\b/)?.[1];
      if (loc) constraints.push({ type: "location", value: loc, source: msg.senderId, confidence: 0.8 });
    }

    if (/\b(vegetarian|vegan|gluten.free|halal|kosher)\b/.test(text)) {
      const diet = text.match(/\b(vegetarian|vegan|gluten.free|halal|kosher)\b/)?.[1];
      if (diet) constraints.push({ type: "dietary", value: diet, source: msg.senderId, confidence: 0.95 });
    }

    if (/\bunder\s*\$?\d+\b|\b\$\d+\b|\bbudget\b/.test(text)) {
      const amount = text.match(/\$?(\d+)/)?.[1];
      if (amount) constraints.push({ type: "budget", value: `under $${amount}`, source: msg.senderId, confidence: 0.85 });
    }

    if (/\bnot too (late|early)\b|\bafter \d|\bbefore \d/.test(text)) {
      const time = text.match(/not too (late|early)|(?:after|before) \d+/)?.[0];
      if (time) constraints.push({ type: "time", value: time, source: msg.senderId, confidence: 0.7 });
    }
  }

  const missingInfo: string[] = [];
  const types = new Set(constraints.map((c) => c.type));
  if (!types.has("budget")) missingInfo.push("budget");
  if (!types.has("time")) missingInfo.push("specific time");
  if (!types.has("location") && !types.has("preference")) missingInfo.push("area or neighborhood");

  return {
    planDescription: `group dinner${constraints.find((c) => c.type === "date") ? ` on ${constraints.find((c) => c.type === "date")!.value}` : ""}`,
    constraints,
    interestedMembers: [...interested],
    missingInfo: missingInfo.slice(0, 2),
  };
}

export function mockGenerateResponse(
  constraints: Constraint[],
  missingInfo: string[],
  _members: Member[]
): string {

  const parts: string[] = [];

  if (constraints.length > 0) {
    const summary = constraints
      .map((c) => {
        if (c.type === "date") return c.value;
        if (c.type === "location") return c.value;
        if (c.type === "budget") return c.value + "/person";
        if (c.type === "dietary") return `${c.value} options`;
        if (c.type === "time") return c.value;
        return c.value;
      })
      .join(", ");
    parts.push(`I have: ${summary}.`);
  }

  if (missingInfo.length > 0) {
    parts.push(`What's the ${missingInfo[0]}?`);
  } else {
    parts.push("Want me to find some options?");
  }

  return parts.join(" ");
}
