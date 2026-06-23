import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Member, Message } from "../src/domain/types.js";
import { handleMessage } from "../src/plan/orchestrator.js";
import { resetParticipation, setParticipation } from "../src/governor/participation.js";
import {
  addConstraint,
  createGroup,
  createPlan,
  getActivePlan,
  getPlan,
  recordDecision,
  resetMemory,
  updatePlanPhase,
} from "../src/store/memory.js";
import type { OutgoingMessage, Transport } from "../src/transport/types.js";

const members: Member[] = [
  { id: "rey", name: "Rey" },
  { id: "maya", name: "Maya" },
  { id: "sam", name: "Sam" },
  { id: "alex", name: "Alex" },
];

class TestTransport implements Transport {
  messages: OutgoingMessage[] = [];

  async send(message: OutgoingMessage): Promise<void> {
    this.messages.push(message);
  }

  async react(): Promise<void> {}

  async sendPoll(): Promise<string> {
    return "poll";
  }
}

function setup() {
  process.env["POLO_MOCK"] = "1";
  resetMemory();
  resetParticipation();
  const groupId = `group-${randomUUID()}`;
  createGroup(groupId, "The Squad", members);
  return { groupId, transport: new TestTransport() };
}

function message(groupId: string, senderId: string, text: string): Message {
  return {
    id: randomUUID(),
    groupId,
    senderId,
    text,
    timestamp: new Date().toISOString(),
    mentionsPolo: /\bpolo\b/i.test(text),
  };
}

async function seedDinnerPlan(groupId: string, transport: Transport) {
  for (const [senderId, text] of [
    ["rey", "dinner saturday?"],
    ["maya", "yes but not too late"],
    ["sam", "downtown?"],
    ["alex", "I'm vegetarian now btw"],
    ["rey", "Polo help us plan this"],
  ] as const) {
    await handleMessage(message(groupId, senderId, text), transport);
  }
}

test("Polo handles the direct answer to its missing-info question", async () => {
  const { groupId, transport } = setup();
  await seedDinnerPlan(groupId, transport);

  const response = await handleMessage(message(groupId, "sam", "under 50"), transport);
  const plan = getActivePlan(groupId);

  assert.ok(response, "Polo should respond when the group answers its budget question");
  assert.ok(plan?.constraints.some((constraint) => constraint.type === "budget" && constraint.value === "under $50"));
  assert.match(response.text, /find some options/i);
});

test("Polo stays quiet when casual chat merely repeats a plan keyword", async () => {
  const { groupId, transport } = setup();
  await seedDinnerPlan(groupId, transport);

  const beforeCount = transport.messages.length;
  const response = await handleMessage(message(groupId, "maya", "saturday is going to be chaos lol"), transport);

  assert.equal(response, null);
  assert.equal(transport.messages.length, beforeCount);
});

test("a decided plan does not block a new planning request", async () => {
  const { groupId, transport } = setup();
  const oldPlan = createPlan(groupId, "old dinner plan");
  recordDecision(groupId, oldPlan.id, {
    selectedOptionId: "ramen",
    summary: "Ramen on Saturday",
    decidedAt: new Date().toISOString(),
  });
  setParticipation(groupId, "quiet", oldPlan.id);

  const response = await handleMessage(message(groupId, "rey", "Polo help plan brunch sunday downtown"), transport);
  const activePlan = getActivePlan(groupId);

  assert.ok(response);
  assert.ok(activePlan);
  assert.notEqual(activePlan.id, oldPlan.id);
  assert.equal(activePlan.phase, "collecting_constraints");
});

test("the participation activePlanId routes updates to the intended open plan", async () => {
  const { groupId, transport } = setup();
  const dinnerPlan = createPlan(groupId, "dinner on saturday");
  updatePlanPhase(groupId, dinnerPlan.id, "collecting_constraints");
  addConstraint(groupId, dinnerPlan.id, {
    type: "date",
    value: "saturday",
    source: "rey",
    confidence: 0.9,
  });

  const brunchPlan = createPlan(groupId, "brunch on sunday");
  updatePlanPhase(groupId, brunchPlan.id, "collecting_constraints");
  addConstraint(groupId, brunchPlan.id, {
    type: "date",
    value: "sunday",
    source: "maya",
    confidence: 0.9,
  });
  setParticipation(groupId, "facilitating", brunchPlan.id);

  await handleMessage(message(groupId, "sam", "Polo downtown works for sunday brunch"), transport);

  const reloadedDinner = getPlan(groupId, dinnerPlan.id);
  const reloadedBrunch = getPlan(groupId, brunchPlan.id);
  assert.equal(reloadedDinner?.constraints.some((constraint) => constraint.source === "sam"), false);
  assert.equal(reloadedBrunch?.constraints.some((constraint) => constraint.source === "sam"), true);
});
