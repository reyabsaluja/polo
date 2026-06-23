import type { GroupId, MemberId, Message, MessageId, PlanId } from "../domain/types.js";

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

export interface OutgoingPollOption {
  id?: string;
  label: string;
  description?: string;
}

export interface OutgoingPoll {
  groupId: GroupId;
  question: string;
  options: Array<string | OutgoingPollOption>;
  deadline?: string;
}

export interface OutgoingPrivateMessage {
  groupId?: GroupId;
  recipientId: MemberId;
  text: string;
}

export interface OutgoingCardField {
  label: string;
  value: string;
}

export interface OutgoingCardAction {
  id: string;
  label: string;
}

export interface OutgoingCard {
  groupId: GroupId;
  title: string;
  body?: string;
  fields?: OutgoingCardField[];
  actions?: OutgoingCardAction[];
}

export interface PollVote {
  groupId: GroupId;
  pollId: string;
  planId: PlanId;
  optionId: string;
  voterId: MemberId;
  optionIndex: number;
}

export interface ReactionEvent {
  groupId: GroupId;
  messageId: MessageId;
  senderId: MemberId;
  emoji: string;
}

export interface PrivateInboundMessage {
  groupId: GroupId;
  senderId: MemberId;
  text: string;
  messageId?: string;
}

export type InboundTransportEvent =
  | { kind: "message"; message: Message }
  | { kind: "poll_vote"; vote: PollVote }
  | { kind: "reaction"; reaction: ReactionEvent }
  | { kind: "private_message"; privateMessage: PrivateInboundMessage };

export interface Transport {
  send(message: OutgoingMessage): Promise<void>;
  react(reaction: OutgoingReaction): Promise<void>;
  sendPoll(poll: OutgoingPoll): Promise<string>;
  sendPrivate(message: OutgoingPrivateMessage): Promise<void>;
  sendCard(card: OutgoingCard): Promise<string>;
}
