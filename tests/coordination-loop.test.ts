import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Member, Message } from "../src/domain/types.js";
import { handleMessage } from "../src/plan/orchestrator.js";
import { resetParticipation } from "../src/governor/participation.js";
import { createGroup, getActivePlan, resetMemory } from "../src/store/memory.js";
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
