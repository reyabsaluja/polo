import * as readline from "node:readline";
import { randomUUID } from "node:crypto";
import type { Member, Message } from "../domain/types.js";
import { memoryRepository } from "../store/memory.js";
import { handleTransportEvent } from "../plan/orchestrator.js";
import { CliTransport } from "./cli-transport.js";

const YELLOW = "\x1b[33m";
const GREEN = "\x1b[32m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

const members: Member[] = [
  { id: "rey", name: "Rey" },
  { id: "maya", name: "Maya" },
  { id: "sam", name: "Sam" },
  { id: "alex", name: "Alex" },
];

const GROUP_ID = "friend-group";
memoryRepository.createGroup(GROUP_ID, "The Squad", members);

const transport = new CliTransport();
let currentUser = members[0]!;

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function printHelp(): void {
  console.log(`
${BOLD}Polo CLI Harness${RESET}
${DIM}Simulates a group chat with Polo.${RESET}

${BOLD}Commands:${RESET}
  ${GREEN}/as <name>${RESET}       Switch who you're speaking as (Rey, Maya, Sam, Alex)
  ${GREEN}/members${RESET}         Show group members
  ${GREEN}/plan${RESET}            Show active plan state
  ${GREEN}/vote <number>${RESET}   Vote for a poll option (1, 2, 3...)
  ${GREEN}/events${RESET}          Show group event log
  ${GREEN}/help${RESET}            Show this help
  ${GREEN}/quit${RESET}            Exit

${BOLD}Usage:${RESET}
  Type a message as the current user. Mention "Polo" to trigger a response.
  Switch users with "/as Maya" to simulate multi-person conversation.
  After a poll is created, use "/vote 1" to vote for the first option.

${BOLD}Full loop example:${RESET}
  > dinner saturday?
  /as Maya
  > yes but not too late
  /as Sam
  > downtown?
  /as Alex
  > I'm vegetarian now btw
  /as Rey
  > Polo help
  (Polo asks for budget)
  > under 50
  (Polo finds options and creates poll)
  /vote 1
  /as Maya
  /vote 1
  /as Sam
  /vote 2
  /as Alex
  /vote 1
  (Polo announces winner)
`);
}

function printPrompt(): void {
  rl.setPrompt(`${YELLOW}${currentUser.name}>${RESET} `);
  rl.prompt();
}

async function handleCommand(input: string): Promise<boolean> {
  const parts = input.trim().split(/\s+/);
  const cmd = parts[0]?.toLowerCase();

  if (cmd === "/as") {
    const name = parts.slice(1).join(" ").toLowerCase();
    const found = members.find((m) => m.name.toLowerCase() === name);
    if (found) {
      currentUser = found;
      console.log(`${DIM}  Now speaking as ${found.name}${RESET}`);
    } else {
      console.log(`${DIM}  Unknown member. Available: ${members.map((m) => m.name).join(", ")}${RESET}`);
    }
    return true;
  }

  if (cmd === "/members") {
    console.log(`${DIM}  Group members: ${members.map((m) => m.name).join(", ")}${RESET}`);
    return true;
  }

  if (cmd === "/plan") {
    const plan = memoryRepository.getActivePlan(GROUP_ID);
    if (!plan) {
      console.log(`${DIM}  No active plan.${RESET}`);
    } else {
      console.log(`${DIM}  Plan: ${plan.description}`);
      console.log(`  Phase: ${plan.phase}`);
      console.log(`  Interested: ${plan.interestedMembers.join(", ") || "none yet"}`);
      console.log(`  Constraints: ${plan.constraints.filter((c) => c.status === "active").length}`);
      for (const c of plan.constraints.filter((c) => c.status === "active")) {
        console.log(`    - ${c.type}: ${c.value} (from ${c.source})`);
      }
      if (plan.options.length > 0) {
        console.log(`  Options:`);
        plan.options.forEach((opt, i) => {
          console.log(`    ${i + 1}. ${opt.label} — ${opt.details} [${opt.votes.length} votes]`);
        });
      }
      if (plan.decision) {
        console.log(`  Decision: ${plan.decision.summary}`);
      }
      if (plan.commitments.length > 0) {
        console.log(`  Commitments:`);
        for (const c of plan.commitments) {
          console.log(`    - ${c.memberId}: ${c.action} ${c.completed ? "✓" : ""}`);
        }
      }
      console.log(`${RESET}`);
    }
    return true;
  }

  if (cmd === "/vote") {
    return handleVote(parts[1]);
  }

  if (cmd === "/events") {
    const events = memoryRepository.getGroupEvents(GROUP_ID);
    const recent = events.slice(-10);
    if (recent.length === 0) {
      console.log(`${DIM}  No events.${RESET}`);
    } else {
      console.log(`${DIM}  Recent events (last ${recent.length}):`);
      for (const e of recent) {
        console.log(`    [${e.type}] ${e.summary}`);
      }
      console.log(`${RESET}`);
    }
    return true;
  }

  if (cmd === "/help") {
    printHelp();
    return true;
  }

  if (cmd === "/quit" || cmd === "/exit") {
    console.log(`${DIM}  Goodbye!${RESET}`);
    rl.close();
    process.exit(0);
  }

  return false;
}

async function handleVote(optionNumber: string | undefined): Promise<boolean> {
  const plan = memoryRepository.getActivePlan(GROUP_ID);
  if (!plan || plan.options.length === 0) {
    console.log(`${DIM}  No active poll to vote on.${RESET}`);
    return true;
  }

  const index = parseInt(optionNumber ?? "", 10) - 1;
  if (isNaN(index) || index < 0 || index >= plan.options.length) {
    console.log(`${DIM}  Invalid option. Choose 1-${plan.options.length}.${RESET}`);
    return true;
  }

  const option = plan.options[index]!;
  const pollCollection = plan.collections.find(
    (c) => c.kind === "poll" && c.status === "open"
  );
  const pollId = pollCollection?.transportRef?.id;

  console.log(`${DIM}  ${currentUser.name} voted for: ${option.label}${RESET}`);

  await handleTransportEvent({
    kind: "poll_vote",
    vote: {
      groupId: GROUP_ID,
      planId: plan.id,
      optionId: option.id,
      voterId: currentUser.id,
      pollId: pollId ?? "",
      optionIndex: index,
    },
  }, transport);

  return true;
}

async function processMessage(text: string): Promise<void> {
  const mentionsPolo = /\bpolo\b/i.test(text);

  const message: Message = {
    id: randomUUID(),
    groupId: GROUP_ID,
    senderId: currentUser.id,
    text,
    timestamp: new Date().toISOString(),
    mentionsPolo,
  };

  const result = await handleTransportEvent({ kind: "message", message }, transport);

  if (result?.newPlan) {
    console.log(`${DIM}  [Plan created: "${result.newPlan.description}"]${RESET}`);
  }
  if (result?.phaseAdvanced) {
    const plan = memoryRepository.getActivePlan(GROUP_ID);
    if (plan) {
      console.log(`${DIM}  [Phase: ${plan.phase}]${RESET}`);
    }
  }
}

console.log(`${BOLD}Polo CLI Harness${RESET}`);
console.log(`${DIM}Group: "The Squad" — Rey, Maya, Sam, Alex${RESET}`);
console.log(`${DIM}Type /help for commands. Mention "Polo" to trigger responses.${RESET}\n`);

const queue: string[] = [];
let processing = false;

async function processQueue(): Promise<void> {
  if (processing) return;
  processing = true;

  while (queue.length > 0) {
    const input = queue.shift()!;
    const trimmed = input.trim();

    if (!trimmed) {
      printPrompt();
      continue;
    }

    if (trimmed.startsWith("/")) {
      await handleCommand(trimmed);
      printPrompt();
      continue;
    }

    try {
      await processMessage(trimmed);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error(`${DIM}  [Error: ${errorMessage}]${RESET}`);
    }

    printPrompt();
  }

  processing = false;
}

printPrompt();

rl.on("line", (input) => {
  queue.push(input);
  processQueue();
});

rl.on("close", () => {
  process.exit(0);
});
