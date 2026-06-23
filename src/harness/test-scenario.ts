import { randomUUID } from "node:crypto";
import type { Message } from "../domain/types.js";
import { createGroup, getActivePlan } from "../store/memory.js";
import { handleMessage } from "../plan/orchestrator.js";
import { CliTransport } from "./cli-transport.js";

const members = [
  { id: "rey", name: "Rey" },
  { id: "maya", name: "Maya" },
  { id: "sam", name: "Sam" },
  { id: "alex", name: "Alex" },
];

const GROUP_ID = "test-group";
createGroup(GROUP_ID, "The Squad", members);

const transport = new CliTransport();

function msg(senderId: string, text: string): Message {
  return {
    id: randomUUID(),
    groupId: GROUP_ID,
    senderId,
    text,
    timestamp: new Date().toISOString(),
    mentionsPolo: /\bpolo\b/i.test(text),
  };
}

async function run() {
  console.log("=== Scenario: Group dinner planning ===\n");

  const messages: Message[] = [
    msg("rey", "dinner saturday?"),
    msg("maya", "yes but not too late"),
    msg("sam", "downtown?"),
    msg("alex", "I'm vegetarian now btw"),
    msg("rey", "@Polo help us plan this"),
  ];

  for (const m of messages) {
    const sender = members.find((mb) => mb.id === m.senderId)!;
    console.log(`  ${sender.name}: ${m.text}`);
    const result = await handleMessage(m, transport);
    if (result?.newPlan) {
      console.log(`  [Plan created: "${result.newPlan.description}"]`);
    }
  }

  console.log("\n=== Plan state ===");
  const plan = getActivePlan(GROUP_ID);
  if (plan) {
    console.log(`  Description: ${plan.description}`);
    console.log(`  Phase: ${plan.phase}`);
    console.log(`  Interested: ${plan.interestedMembers.join(", ")}`);
    console.log(`  Constraints:`);
    for (const c of plan.constraints) {
      console.log(`    - ${c.type}: ${c.value} (from ${c.source})`);
    }
  } else {
    console.log("  No plan created.");
  }
}

run().catch(console.error);
