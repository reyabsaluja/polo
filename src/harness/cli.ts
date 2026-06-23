import * as readline from "node:readline";
import { randomUUID } from "node:crypto";
import type { Member, Message } from "../domain/types.js";
import { createGroup, getActivePlan } from "../store/memory.js";
import { handleMessage } from "../plan/orchestrator.js";
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
createGroup(GROUP_ID, "The Squad", members);

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
  ${GREEN}/as <name>${RESET}     Switch who you're speaking as (Rey, Maya, Sam, Alex)
  ${GREEN}/members${RESET}       Show group members
  ${GREEN}/plan${RESET}          Show active plan state
  ${GREEN}/help${RESET}          Show this help
  ${GREEN}/quit${RESET}          Exit

${BOLD}Usage:${RESET}
  Type a message as the current user. Mention "Polo" to trigger a response.
  Switch users with "/as Maya" to simulate multi-person conversation.

${BOLD}Example:${RESET}
  > dinner saturday?
  /as Maya
  > yes but not too late
  /as Sam
  > downtown?
  /as Alex
  > I'm vegetarian now btw
  /as Rey
  > @Polo help
`);
}

function printPrompt(): void {
  rl.setPrompt(`${YELLOW}${currentUser.name}>${RESET} `);
  rl.prompt();
}

function handleCommand(input: string): boolean {
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
    const plan = getActivePlan(GROUP_ID);
    if (!plan) {
      console.log(`${DIM}  No active plan.${RESET}`);
    } else {
      console.log(`${DIM}  Plan: ${plan.description}`);
      console.log(`  Phase: ${plan.phase}`);
      console.log(`  Interested: ${plan.interestedMembers.join(", ") || "none yet"}`);
      console.log(`  Constraints: ${plan.constraints.length}`);
      plan.constraints.forEach((c) => {
        console.log(`    - ${c.type}: ${c.value} (from ${c.source})`);
      });
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

  const result = await handleMessage(message, transport);

  if (result?.newPlan) {
    console.log(`${DIM}  [Plan created: "${result.newPlan.description}"]${RESET}`);
  }
}

console.log(`${BOLD}Polo CLI Harness${RESET}`);
console.log(`${DIM}Group: "The Squad" — Rey, Maya, Sam, Alex${RESET}`);
console.log(`${DIM}Type /help for commands. Mention "Polo" to trigger responses.${RESET}\n`);

printPrompt();

rl.on("line", async (input) => {
  const trimmed = input.trim();
  if (!trimmed) {
    printPrompt();
    return;
  }

  if (trimmed.startsWith("/")) {
    if (handleCommand(trimmed)) {
      printPrompt();
      return;
    }
  }

  try {
    await processMessage(trimmed);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error(`${DIM}  [Error: ${errorMessage}]${RESET}`);
  }

  printPrompt();
});

rl.on("close", () => {
  process.exit(0);
});
