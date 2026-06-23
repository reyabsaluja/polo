export type MemberId = string;
export type GroupId = string;
export type PlanId = string;
export type MessageId = string;

export type ConstraintType =
  | "date"
  | "time"
  | "location"
  | "budget"
  | "dietary"
  | "attendance"
  | "preference";

export type ConstraintStatus = "active" | "superseded";
export type ConstraintScope = "shared" | "private" | "ephemeral";

export interface Member {
  id: MemberId;
  name: string;
}

export interface Group {
  id: GroupId;
  name: string;
  members: Member[];
  createdAt: string;
}

export interface Message {
  id: MessageId;
  groupId: GroupId;
  senderId: MemberId;
  text: string;
  replyTo?: MessageId;
  timestamp: string;
  mentionsPolo: boolean;
  scope?: ConstraintScope;
}

export interface PrivateContext {
  id: string;
  groupId: GroupId;
  memberId: MemberId;
  messageId: MessageId;
  scope: Exclude<ConstraintScope, "shared">;
  text: string;
  capturedAt: string;
}

export type GroupEventType =
  | "message.received"
  | "message.sent"
  | "plan.created"
  | "plan.route_added"
  | "plan.phase_updated"
  | "collection.created"
  | "collection.response_recorded"
  | "collection.closed"
  | "constraint.recorded"
  | "expected_input.opened"
  | "expected_input.satisfied"
  | "poll.vote_recorded"
  | "decision.recorded"
  | "commitment.recorded";

export interface GroupEvent {
  id: string;
  groupId: GroupId;
  type: GroupEventType;
  occurredAt: string;
  actorId?: MemberId;
  planId?: PlanId;
  messageId?: MessageId;
  summary: string;
  payload: Record<string, unknown>;
}

export interface Constraint {
  id: string;
  type: ConstraintType;
  value: string;
  source: MemberId;
  sourceMessageId: MessageId;
  confidence: number;
  status: ConstraintStatus;
  scope: ConstraintScope;
  capturedAt: string;
}

export interface ExpectedInput {
  id: string;
  kind: "constraint";
  constraintType: ConstraintType;
  prompt: string;
  requestedAt: string;
  requestedByMessageId: MessageId;
  status: "open" | "satisfied" | "cancelled";
  satisfiedByMessageId?: MessageId;
}

export type PlanRouteKind = "message" | "poll" | "card" | "thread";

export interface PlanRoute {
  id: string;
  kind: PlanRouteKind;
  value: string;
  createdAt: string;
  sourceMessageId?: MessageId;
}

export interface PlanRoutingHints {
  preferredPlanId?: PlanId;
  replyTo?: MessageId;
  pollId?: string;
  cardId?: string;
  threadId?: string;
}

export type CollectionKind = "constraint" | "availability" | "poll" | "rsvp";
export type CollectionStatus = "open" | "closed" | "cancelled";
export type CollectionVisibility = "public" | "private" | "anonymous";
export type CollectionParticipantStatus = "pending" | "responded" | "declined" | "excluded";
export type DecisionRule = "unanimous" | "majority" | "anyone" | "organizer";

export interface CollectionParticipant {
  memberId: MemberId;
  status: CollectionParticipantStatus;
  respondedAt?: string;
}

export interface CollectionResponse {
  id: string;
  memberId: MemberId;
  value: string;
  scope: ConstraintScope;
  capturedAt: string;
  sourceMessageId?: MessageId;
}

export interface TransportReference {
  kind: "message" | "poll" | "card";
  id: string;
}

export interface Collection {
  id: string;
  groupId: GroupId;
  planId: PlanId;
  kind: CollectionKind;
  prompt: string;
  status: CollectionStatus;
  visibility: CollectionVisibility;
  decisionRule?: DecisionRule;
  deadline?: string;
  participants: CollectionParticipant[];
  responses: CollectionResponse[];
  options?: PlanOption[];
  transportRef?: TransportReference;
  createdAt: string;
  updatedAt: string;
}

export interface CreateCollectionInput {
  kind: CollectionKind;
  prompt: string;
  targetMemberIds?: MemberId[];
  visibility?: CollectionVisibility;
  decisionRule?: DecisionRule;
  deadline?: string;
  options?: PlanOption[];
  transportRef?: TransportReference;
}

export type PlanPhase =
  | "gathering_intent"
  | "collecting_constraints"
  | "finding_options"
  | "polling"
  | "decided"
  | "following_through"
  | "complete";

export interface Plan {
  id: PlanId;
  groupId: GroupId;
  phase: PlanPhase;
  description: string;
  constraints: Constraint[];
  interestedMembers: MemberId[];
  options: PlanOption[];
  expectedInputs: ExpectedInput[];
  collections: Collection[];
  routes: PlanRoute[];
  decision?: Decision;
  commitments: Commitment[];
  createdAt: string;
  updatedAt: string;
}

export interface PlanOption {
  id: string;
  label: string;
  details: string;
  votes: MemberId[];
}

export interface Decision {
  selectedOptionId: string;
  summary: string;
  decidedAt: string;
}

export interface Commitment {
  memberId: MemberId;
  action: string;
  dueBy?: string;
  completed: boolean;
}

