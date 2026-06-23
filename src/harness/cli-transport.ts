import { randomUUID } from "node:crypto";
import type {
  OutgoingCard,
  OutgoingMessage,
  OutgoingPoll,
  OutgoingPollOption,
  OutgoingPrivateMessage,
  OutgoingReaction,
  Transport,
} from "../transport/types.js";

const CYAN = "\x1b[36m";
const RESET = "\x1b[0m";
const DIM = "\x1b[2m";

export class CliTransport implements Transport {
  async send(message: OutgoingMessage): Promise<void> {
    console.log(`\n${CYAN}  Polo:${RESET} ${message.text}`);
    if (message.replyTo) {
      console.log(`${DIM}  (replying to ${message.replyTo})${RESET}`);
    }
  }

  async react(reaction: OutgoingReaction): Promise<void> {
    console.log(`${DIM}  Polo reacted ${reaction.emoji} to message ${reaction.messageId}${RESET}`);
  }

  async sendPoll(poll: OutgoingPoll): Promise<string> {
    console.log(`\n${CYAN}  Polo [POLL]:${RESET} ${poll.question}`);
    poll.options.forEach((opt, i) => {
      console.log(`    ${i + 1}. ${optionLabel(opt)}`);
    });
    if (poll.deadline) {
      console.log(`${DIM}  Deadline: ${poll.deadline}${RESET}`);
    }
    return `poll_${randomUUID()}`;
  }

  async sendPrivate(message: OutgoingPrivateMessage): Promise<void> {
    console.log(`\n${CYAN}  Polo [PRIVATE to ${message.recipientId}]:${RESET} ${message.text}`);
  }

  async sendCard(card: OutgoingCard): Promise<string> {
    console.log(`\n${CYAN}  Polo [CARD]:${RESET} ${card.title}`);
    if (card.body) console.log(`  ${card.body}`);
    card.fields?.forEach((field) => console.log(`  ${field.label}: ${field.value}`));
    card.actions?.forEach((action) => console.log(`  [${action.id}] ${action.label}`));
    return `card_${randomUUID()}`;
  }
}

function optionLabel(option: string | OutgoingPollOption): string {
  return typeof option === "string" ? option : option.label;
}
