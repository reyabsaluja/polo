import type { GroupId, MemberId, MessageId } from "../domain/types.js";

export interface OutgoingMessage {
  groupId: GroupId;
  text: string;
  replyTo?: MessageId;
}

export interface OutgoingReaction {
  groupId: GroupId;
  messageId: MessageId;
  emoji: string;
}

export interface OutgoingPoll {
  groupId: GroupId;
  question: string;
  options: string[];
  deadline?: string;
}

export interface PollVote {
  groupId: GroupId;
  pollId: string;
  voterId: MemberId;
  optionIndex: number;
}

export interface Transport {
  send(message: OutgoingMessage): Promise<void>;
  react(reaction: OutgoingReaction): Promise<void>;
  sendPoll(poll: OutgoingPoll): Promise<string>;
}
