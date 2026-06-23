import type { Group, Member, Plan, PlanOption } from "../domain/types.js";
import { randomUUID } from "node:crypto";
import { groupSafeConstraints } from "../privacy/context.js";
import { getClient } from "./client.js";
import { extractJsonObject } from "./extract-constraints.js";

interface OptionsResult {
  options: PlanOption[];
  reasoning: string;
}

export async function findOptions(plan: Plan, group: Group): Promise<OptionsResult> {
  const activeConstraints = groupSafeConstraints(plan.constraints);
  const memberMap = new Map(group.members.map((m: Member) => [m.id, m.name]));

  const constraintText = activeConstraints
    .map((c) => `- ${c.type}: ${c.value} (from ${memberMap.get(c.source) ?? c.source})`)
    .join("\n");

  let text: string;
  try {
    const response = await getClient().messages.create({
      model: "claude-sonnet-4-6-20250514",
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: `You are helping a friend group find options for: "${plan.description}"

Group constraints:
${constraintText}

Find exactly 3 real, specific options that satisfy ALL the stated constraints. For each option, provide:
- A short name/label
- A 1-sentence description covering why it fits (price, location, dietary needs met, etc.)

Return as JSON:
{
  "options": [
    {"label": "Option name", "details": "Why it fits the constraints"},
    {"label": "Option name", "details": "Why it fits the constraints"},
    {"label": "Option name", "details": "Why it fits the constraints"}
  ],
  "reasoning": "One sentence explaining how you filtered for these"
}

Rules:
- All options MUST satisfy every stated dietary constraint
- All options MUST be in the stated location/area
- All options MUST be within the stated budget
- Prefer variety (different cuisines or experiences)
- Be specific: real restaurant names, real venues, real places
- If constraints are too vague to find real places, suggest realistic-sounding options

Return ONLY the JSON.`,
        },
      ],
    });
    text = response.content[0]?.type === "text" ? response.content[0].text : "";
  } catch {
    return {
      options: [],
      reasoning: "Could not reach AI service.",
    };
  }

  return parseOptionsResponse(text);
}

function parseOptionsResponse(text: string): OptionsResult {
  try {
    const jsonStr = extractJsonObject(text);
    const parsed = JSON.parse(jsonStr);

    const options: PlanOption[] = (parsed.options ?? [])
      .slice(0, 4)
      .map((opt: Record<string, unknown>) => ({
        id: randomUUID(),
        label: String(opt.label ?? "Option"),
        details: String(opt.details ?? ""),
        votes: [],
      }));

    return {
      options,
      reasoning: String(parsed.reasoning ?? ""),
    };
  } catch {
    return {
      options: [],
      reasoning: "Could not generate options from the given constraints.",
    };
  }
}

export function mockFindOptions(plan: Plan, _group: Group): OptionsResult {
  const constraints = groupSafeConstraints(plan.constraints);
  const hasDietary = constraints.find((c) => c.type === "dietary");
  const location = constraints.find((c) => c.type === "location")?.value ?? "nearby";
  const budget = constraints.find((c) => c.type === "budget")?.value ?? "";

  const options: PlanOption[] = [
    {
      id: randomUUID(),
      label: "Kumo Ramen",
      details: `${location}, ${hasDietary ? hasDietary.value + " options" : "varied menu"}, ${budget || "moderate"}`,
      votes: [],
    },
    {
      id: randomUUID(),
      label: "Verde Kitchen",
      details: `${location}, fully plant-based, ${budget || "moderate"}`,
      votes: [],
    },
    {
      id: randomUUID(),
      label: "The Patio",
      details: `${location}, Mediterranean with ${hasDietary ? hasDietary.value + " options" : "diverse menu"}, ${budget || "moderate"}`,
      votes: [],
    },
  ];

  return {
    options,
    reasoning: `Filtered for ${location} restaurants meeting all dietary needs within budget.`,
  };
}

