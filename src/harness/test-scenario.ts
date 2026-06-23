import { randomUUID } from "node:crypto";
import type { Message, Plan } from "../domain/types.js";
import { memoryRepository } from "../store/memory.js";
import { handleTransportEvent } from "../plan/orchestrator.js";
import { CliTransport } from "./cli-transport.js";

const members = [
  { id: "rey", name: "Rey" },
  { id: "maya", name: "Maya" },
  { id: "sam", name: "Sam" },
  { id: "alex", name: "Alex" },
];

const GROUP_ID = "test-group";
memoryRepository.createGroup(GROUP_ID, "The Squad", members);

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

async function castVotes(plan: Plan, transport: CliTransport): Promise<void> {
  if (plan.options.length === 0) {
    console.log("  No options to vote on.");
    return;
  }

  console.log(`  Options:`);
  plan.options.forEach((opt, i) => {
    console.log(`    ${i + 1}. ${opt.label} — ${opt.details}`);
  });

  const firstOption = plan.options[0]!;
  const secondOption = plan.options[1] ?? firstOption;
  const pollCollection = plan.collections.find((c) => c.kind === "poll" && c.status === "open");
  const pollId = pollCollection?.transportRef?.id ?? "";

  const votes = [
    { voterId: "rey", optionId: firstOption.id },
    { voterId: "maya", optionId: firstOption.id },
    { voterId: "sam", optionId: secondOption.id },
    { voterId: "alex", optionId: firstOption.id },
  ];

  for (const vote of votes) {
    const voter = members.find((m) => m.id === vote.voterId)!;
    const option = plan.options.find((o) => o.id === vote.optionId)!;
    console.log(`  ${voter.name} votes for: ${option.label}`);

    await handleTransportEvent({
      kind: "poll_vote",
      vote: {
        groupId: GROUP_ID,
        planId: plan.id,
        optionId: vote.optionId,
        voterId: vote.voterId,
        pollId,
        optionIndex: plan.options.indexOf(option),
      },
    }, transport);
  }
}

async function run() {
  console.log("=== Full Planning Loop Scenario ===\n");

  // Phase 1: Gathering intent
  console.log("--- Phase 1: Group discusses dinner ---");
  const conversation: Message[] = [
    msg("rey", "dinner saturday?"),
    msg("maya", "yes but not too late"),
    msg("sam", "downtown?"),
    msg("alex", "I'm vegetarian now btw"),
    msg("rey", "@Polo help us plan this"),
  ];

  for (const m of conversation) {
    const sender = members.find((mb) => mb.id === m.senderId)!;
    console.log(`  ${sender.name}: ${m.text}`);
    const result = await handleTransportEvent({ kind: "message", message: m }, transport);
    if (result?.newPlan) {
      console.log(`  [Plan created: "${result.newPlan.description}"]`);
    }
  }

  // Phase 2: Providing missing constraint (budget)
  console.log("\n--- Phase 2: Providing budget ---");
  const budgetMsg = msg("sam", "under 50");
  console.log(`  Sam: ${budgetMsg.text}`);
  await handleTransportEvent({ kind: "message", message: budgetMsg }, transport);

  // Check plan state
  const plan = memoryRepository.getActivePlan(GROUP_ID);
  if (!plan) {
    console.log("  ERROR: No plan exists!");
    return;
  }

  console.log(`\n--- Plan state after constraint collection ---`);
  console.log(`  Phase: ${plan.phase}`);
  console.log(`  Constraints: ${plan.constraints.filter((c) => c.status === "active").length}`);
  for (const c of plan.constraints.filter((c) => c.status === "active")) {
    console.log(`    - ${c.type}: ${c.value} (from ${c.source})`);
  }

  // Phase 3: If we're in polling phase, vote
  if (plan.phase === "polling" && plan.options.length > 0) {
    console.log("\n--- Phase 3: Voting ---");
    await castVotes(plan, transport);

    const finalPlan = memoryRepository.getActivePlan(GROUP_ID);
    console.log("\n--- Final Plan State ---");
    if (finalPlan) {
      console.log(`  Phase: ${finalPlan.phase}`);
      if (finalPlan.decision) {
        console.log(`  Decision: ${finalPlan.decision.summary}`);
      }
      console.log(`  Options with votes:`);
      finalPlan.options.forEach((opt) => {
        console.log(`    - ${opt.label}: ${opt.votes.length} votes`);
      });
    }
  } else if (plan.phase === "collecting_constraints") {
    console.log("\n  (Plan still collecting constraints — need more info to advance to options)");
    console.log("  Try mentioning Polo again after providing more constraints.");

    // Let's try triggering advancement with explicit ask
    console.log("\n--- Triggering option search ---");
    const triggerMsg = msg("rey", "Polo find us some places");
    console.log(`  Rey: ${triggerMsg.text}`);
    await handleTransportEvent({ kind: "message", message: triggerMsg }, transport);

    const updatedPlan = memoryRepository.getActivePlan(GROUP_ID);
    if (updatedPlan && updatedPlan.phase === "polling") {
      console.log("\n--- Phase 3: Voting ---");
      await castVotes(updatedPlan, transport);

      const finalPlan = memoryRepository.getPlan(GROUP_ID, updatedPlan.id);
      console.log("\n--- Final Plan State ---");
      if (finalPlan) {
        console.log(`  Phase: ${finalPlan.phase}`);
        if (finalPlan.decision) {
          console.log(`  Decision: ${finalPlan.decision.summary}`);
        }
      }
    }
  }

  // Show event log summary
  console.log("\n--- Event Log (last 10) ---");
  const events = memoryRepository.getGroupEvents(GROUP_ID);
  for (const e of events.slice(-10)) {
    console.log(`  [${e.type}] ${e.summary}`);
  }
}

run().catch(console.error);
