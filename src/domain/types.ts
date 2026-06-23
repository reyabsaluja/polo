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

export type ConstraintStatus = "active" | "superseded" | "rejected";
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
  normalizedValue?: string;
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

export interface Poll {
  planId: PlanId;
  question: string;
  options: PlanOption[];
  deadline?: string;
  closed: boolean;
}
