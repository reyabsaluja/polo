import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Constraint, ConstraintType, Member, Message } from "../src/domain/types.js";
import { parseExtractionJson } from "../src/ai/extract-constraints.js";
import { handleMessage, handleTransportEvent } from "../src/plan/orchestrator.js";
import { resetParticipation, setParticipation } from "../src/governor/participation.js";
import {
  addConstraint,
  createCollection,
  createGroup,
  createPlan,
  getActivePlan,
  getCollection,
  getGroupEvents,
  getOpenCollections,
  getPrivateContexts,
  getPlan,
  recordDecision,
  resetMemory,
  setPlanOptions,
  updatePlanPhase,
} from "../src/store/memory.js";
import type { OutgoingCard, OutgoingMessage, OutgoingPrivateMessage, Transport } from "../src/transport/types.js";
import { formatMessagesForPrompt } from "../src/privacy/context.js";

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

  async sendPrivate(_message: OutgoingPrivateMessage): Promise<void> {}

  async sendCard(_card: OutgoingCard): Promise<string> {
    return "card";
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

function constraint(type: ConstraintType, value: string, source: string, sourceMessageId = randomUUID()): Constraint {
  return {
    id: randomUUID(),
    type,
    value,
    source,
    sourceMessageId,
    confidence: 0.9,
    status: "active",
    scope: "shared",
    capturedAt: new Date().toISOString(),
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

test("missing-info questions open collection state", async () => {
  const { groupId, transport } = setup();
  await seedDinnerPlan(groupId, transport);

  const plan = getActivePlan(groupId);
  assert.ok(plan);

  const collections = getOpenCollections(groupId, plan.id, "constraint");
  assert.equal(collections.length, 1);
  assert.equal(collections[0]?.visibility, "public");
  assert.match(collections[0]?.prompt ?? "", /budget/i);
  assert.deepEqual(collections[0]?.participants.map((participant) => participant.status), [
    "pending",
    "pending",
    "pending",
    "pending",
  ]);
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
  addConstraint(groupId, dinnerPlan.id, constraint("date", "saturday", "rey"));

  const brunchPlan = createPlan(groupId, "brunch on sunday");
  updatePlanPhase(groupId, brunchPlan.id, "collecting_constraints");
  addConstraint(groupId, brunchPlan.id, constraint("date", "sunday", "maya"));
  setParticipation(groupId, "facilitating", brunchPlan.id);

  await handleMessage(message(groupId, "sam", "Polo downtown works for sunday brunch"), transport);

  const reloadedDinner = getPlan(groupId, dinnerPlan.id);
  const reloadedBrunch = getPlan(groupId, brunchPlan.id);
  assert.equal(reloadedDinner?.constraints.some((constraint) => constraint.source === "sam"), false);
  assert.equal(reloadedBrunch?.constraints.some((constraint) => constraint.source === "sam"), true);
});

test("reply hints route updates to the referenced plan before the active plan", async () => {
  const { groupId, transport } = setup();
  const dinnerMessageId = randomUUID();
  const brunchMessageId = randomUUID();

  const dinnerPlan = createPlan(groupId, "dinner on saturday");
  updatePlanPhase(groupId, dinnerPlan.id, "collecting_constraints");
  addConstraint(groupId, dinnerPlan.id, constraint("date", "saturday", "rey", dinnerMessageId));

  const brunchPlan = createPlan(groupId, "brunch on sunday");
  updatePlanPhase(groupId, brunchPlan.id, "collecting_constraints");
  addConstraint(groupId, brunchPlan.id, constraint("date", "sunday", "maya", brunchMessageId));
  setParticipation(groupId, "facilitating", brunchPlan.id);

  await handleMessage(
    {
      ...message(groupId, "sam", "downtown works for saturday dinner"),
      replyTo: dinnerMessageId,
    },
    transport
  );

  const reloadedDinner = getPlan(groupId, dinnerPlan.id);
  const reloadedBrunch = getPlan(groupId, brunchPlan.id);
  assert.equal(reloadedDinner?.constraints.some((candidate) => candidate.source === "sam"), true);
  assert.equal(reloadedBrunch?.constraints.some((candidate) => candidate.source === "sam"), false);
});

test("changed constraints keep provenance instead of overwriting history", async () => {
  const { groupId, transport } = setup();
  const first = message(groupId, "rey", "Polo dinner saturday downtown");
  const second = message(groupId, "rey", "Polo actually sunday downtown");

  await handleMessage(first, transport);
  await handleMessage(second, transport);

  const plan = getActivePlan(groupId);
  const dates = plan?.constraints.filter((candidate) => candidate.type === "date") ?? [];

  assert.equal(dates.length, 2);
  assert.ok(dates.some((candidate) => candidate.value === "saturday" && candidate.status === "superseded"));
  assert.ok(dates.some((candidate) => candidate.value === "sunday" && candidate.status === "active"));
  assert.ok(dates.some((candidate) => candidate.sourceMessageId === first.id));
  assert.ok(dates.some((candidate) => candidate.sourceMessageId === second.id));
});

test("private-scoped messages do not create a public group response", async () => {
  const { groupId, transport } = setup();
  const privateMessage = {
    ...message(groupId, "maya", "Polo I can only do this if budget is under 20"),
    scope: "private" as const,
  };

  const response = await handleMessage(privateMessage, transport);

  assert.equal(response, null);
  assert.equal(transport.messages.length, 0);
  assert.equal(getActivePlan(groupId), undefined);

  const contexts = getPrivateContexts(groupId, "maya");
  assert.equal(contexts.length, 1);
  assert.equal(contexts[0]?.text, privateMessage.text);

  const receivedEvent = getGroupEvents(groupId).find((event) => event.messageId === privateMessage.id);
  assert.deepEqual(receivedEvent?.payload, { scope: "private", redacted: true });
});

test("prompt formatting excludes private raw message text", () => {
  const groupId = "privacy-format";
  const publicMessage = message(groupId, "rey", "dinner saturday");
  const privateMessage = {
    ...message(groupId, "maya", "secret medical constraint"),
    scope: "private" as const,
  };

  const promptText = formatMessagesForPrompt([publicMessage, privateMessage], members);

  assert.match(promptText, /dinner saturday/);
  assert.doesNotMatch(promptText, /secret medical constraint/);
});

test("AI extraction parsing rejects invalid model output", () => {
  const groupId = "validation";
  const reyMessage = message(groupId, "rey", "dinner under 50");
  const mayaMessage = message(groupId, "maya", "downtown works");
  const parsed = parseExtractionJson(
    JSON.stringify({
      planDescription: " dinner ",
      constraints: [
        { type: "budget", value: "under $50", source: "rey", sourceMessageId: "made-up", confidence: 2 },
        { type: "mood", value: "fun", source: "rey", sourceMessageId: reyMessage.id, confidence: 0.8 },
        { type: "location", value: "downtown", source: "ghost", sourceMessageId: mayaMessage.id, confidence: 0.8 },
        { type: "time", value: "", source: "maya", sourceMessageId: mayaMessage.id, confidence: 0.8 },
      ],
      interestedMembers: ["rey", "ghost", "maya", "rey"],
      missingInfo: ["time", 42, "budget", "extra"],
    }),
    [reyMessage, mayaMessage],
    members,
    "now"
  );

  assert.equal(parsed.planDescription, "dinner");
  assert.equal(parsed.constraints.length, 1);
  assert.equal(parsed.constraints[0]?.type, "budget");
  assert.equal(parsed.constraints[0]?.sourceMessageId, reyMessage.id);
  assert.equal(parsed.constraints[0]?.confidence, 1);
  assert.deepEqual(parsed.interestedMembers, ["rey", "maya"]);
  assert.deepEqual(parsed.missingInfo, ["time", "budget"]);
});

test("duplicate inbound message ids are idempotent", async () => {
  const { groupId, transport } = setup();
  const inbound = message(groupId, "rey", "Polo dinner saturday downtown");

  const first = await handleMessage(inbound, transport);
  const duplicate = await handleMessage(inbound, transport);

  assert.ok(first);
  assert.equal(duplicate, null);
  assert.equal(transport.messages.length, 1);
});

test("group event ledger records core coordination actions", async () => {
  const { groupId, transport } = setup();
  await handleMessage(message(groupId, "rey", "Polo dinner saturday downtown"), transport);

  const eventTypes = getGroupEvents(groupId).map((event) => event.type);

  assert.ok(eventTypes.includes("message.received"));
  assert.ok(eventTypes.includes("plan.created"));
  assert.ok(eventTypes.includes("constraint.recorded"));
  assert.ok(eventTypes.includes("message.sent"));
});

test("inbound message transport events dispatch through the orchestrator", async () => {
  const { groupId, transport } = setup();
  const response = await handleTransportEvent(
    { kind: "message", message: message(groupId, "rey", "Polo dinner saturday downtown") },
    transport
  );

  assert.ok(response);
  assert.equal(transport.messages.length, 1);
});

test("inbound poll vote events update the target plan option", async () => {
  const { groupId, transport } = setup();
  const plan = createPlan(groupId, "dinner poll");
  setPlanOptions(groupId, plan.id, [
    { id: "ramen", label: "Ramen", details: "Kumo", votes: [] },
    { id: "thai", label: "Thai", details: "Som Saa", votes: [] },
  ]);
  const collection = createCollection(groupId, plan.id, {
    kind: "poll",
    prompt: "Dinner?",
    targetMemberIds: ["maya", "sam"],
    transportRef: { kind: "poll", id: "poll-1" },
  });

  assert.ok(collection);

  await handleTransportEvent(
    {
      kind: "poll_vote",
      vote: {
        groupId,
        pollId: "poll-1",
        planId: plan.id,
        optionId: "ramen",
        optionIndex: 0,
        voterId: "maya",
      },
    },
    transport
  );
  await handleTransportEvent(
    {
      kind: "poll_vote",
      vote: {
        groupId,
        pollId: "poll-1",
        planId: plan.id,
        optionId: "thai",
        optionIndex: 1,
        voterId: "maya",
      },
    },
    transport
  );

  assert.deepEqual(getPlan(groupId, plan.id)?.options[0]?.votes, []);
  assert.deepEqual(getPlan(groupId, plan.id)?.options[1]?.votes, ["maya"]);
  assert.deepEqual(getCollection(groupId, plan.id, collection.id)?.responses.map((response) => response.value), ["thai"]);
});
