import type { Transport, OutgoingMessage, OutgoingReaction, OutgoingPoll } from "../transport/types.js";

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
      console.log(`    ${i + 1}. ${opt}`);
    });
    if (poll.deadline) {
      console.log(`${DIM}  Deadline: ${poll.deadline}${RESET}`);
    }
    return `poll_${Date.now()}`;
  }
}
