import type {
  Commitment,
  Collection,
  CollectionKind,
  Constraint,
  ConstraintScope,
  ConstraintType,
  CreateCollectionInput,
  Decision,
  ExpectedInput,
  Group,
  GroupEvent,
  GroupId,
  Member,
  MemberId,
  Message,
  MessageId,
  Plan,
  PlanId,
  PlanOption,
  PlanPhase,
  PlanRoute,
  PlanRouteKind,
  PlanRoutingHints,
  PrivateContext,
} from "../domain/types.js";
import type { GroupParticipation, ParticipationState } from "../governor/participation.js";

export interface CoordinationRepository {
  createGroup(id: GroupId, name: string, members: Member[]): Group;
  resetMemory(): void;
  getGroup(id: GroupId): Group | undefined;
  getMember(groupId: GroupId, memberId: MemberId): Member | undefined;
  storeMessage(message: Message): boolean;
  getRecentMessages(groupId: GroupId, count: number): Message[];
  getPrivateContexts(groupId: GroupId, memberId?: MemberId): PrivateContext[];
  createPlan(groupId: GroupId, description: string): Plan;
  getActivePlan(groupId: GroupId): Plan | undefined;
  getPlan(groupId: GroupId, planId: PlanId): Plan | undefined;
  getRoutablePlan(groupId: GroupId, routing?: PlanRoutingHints): Plan | undefined;
  addPlanRoute(
    groupId: GroupId,
    planId: PlanId,
    kind: PlanRouteKind,
    value: string,
    sourceMessageId?: MessageId
  ): PlanRoute | undefined;
  createCollection(groupId: GroupId, planId: PlanId, input: CreateCollectionInput): Collection | undefined;
  getCollection(groupId: GroupId, planId: PlanId, collectionId: string): Collection | undefined;
  getOpenCollections(groupId: GroupId, planId: PlanId, kind?: CollectionKind): Collection[];
  linkCollectionTransportRef(
    groupId: GroupId,
    planId: PlanId,
    collectionId: string,
    kind: "message" | "poll" | "card",
    id: string
  ): void;
  recordCollectionResponse(
    groupId: GroupId,
    planId: PlanId,
    collectionId: string,
    memberId: MemberId,
    value: string,
    sourceMessageId?: MessageId,
    scope?: ConstraintScope
  ): void;
  closeCollection(groupId: GroupId, planId: PlanId, collectionId: string): void;
  updatePlanPhase(groupId: GroupId, planId: PlanId, phase: PlanPhase): void;
  getOpenExpectedInput(groupId: GroupId, planId: PlanId): ExpectedInput | undefined;
  setOpenConstraintInput(
    groupId: GroupId,
    planId: PlanId,
    constraintType: ConstraintType,
    prompt: string,
    requestedByMessageId: MessageId
  ): ExpectedInput | undefined;
  satisfyExpectedInput(groupId: GroupId, planId: PlanId, inputId: string, messageId: MessageId): void;
  addConstraint(groupId: GroupId, planId: PlanId, constraint: Constraint): void;
  addInterestedMember(groupId: GroupId, planId: PlanId, memberId: MemberId): void;
  setPlanOptions(groupId: GroupId, planId: PlanId, options: PlanOption[]): void;
  recordVote(groupId: GroupId, planId: PlanId, optionId: string, memberId: MemberId, pollId?: string): void;
  recordDecision(groupId: GroupId, planId: PlanId, decision: Decision): void;
  addCommitment(groupId: GroupId, planId: PlanId, commitment: Commitment): void;
  saveSharedMemory(groupId: GroupId, key: string, value: string): void;
  getSharedMemory(groupId: GroupId, key: string): string | undefined;
  recordOutgoingMessage(groupId: GroupId, text: string, planId?: PlanId, messageId?: MessageId): void;
  getGroupEvents(groupId: GroupId): GroupEvent[];
}

export interface ParticipationRepository {
  getParticipation(groupId: GroupId): GroupParticipation;
  setParticipation(groupId: GroupId, state: ParticipationState, activePlanId?: PlanId): void;
  resetParticipation(): void;
}
