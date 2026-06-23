import type { Constraint, ConstraintScope, Member, Message } from "../domain/types.js";

export function messageScope(message: Message): ConstraintScope {
  return message.scope ?? "shared";
}

export function isGroupSafeMessage(message: Message): boolean {
  return messageScope(message) === "shared";
}

export function groupSafeMessages(messages: Message[]): Message[] {
  return messages.filter(isGroupSafeMessage);
}

export function groupSafeConstraints(constraints: Constraint[]): Constraint[] {
  return constraints.filter((constraint) => constraint.scope === "shared" && constraint.status === "active");
}

export function formatMessagesForPrompt(messages: Message[], members: Member[]): string {
  const memberMap = new Map(members.map((member) => [member.id, member.name]));
  return groupSafeMessages(messages)
    .map((message) => `${memberMap.get(message.senderId) ?? message.senderId} [message_id: ${message.id}]: ${message.text}`)
    .join("\n");
}

export function formatConstraintsForPrompt(constraints: Constraint[], members: Member[]): string {
  const memberMap = new Map(members.map((member) => [member.id, member.name]));
  const safeConstraints = groupSafeConstraints(constraints);
  if (!safeConstraints.length) return "None extracted yet.";

  return safeConstraints
    .map((constraint) => {
      const sourceName = memberMap.get(constraint.source) ?? constraint.source;
      return `- ${constraint.type}: ${constraint.value} (from ${sourceName}; message_id: ${constraint.sourceMessageId})`;
    })
    .join("\n");
}

export function formatTriggerForPrompt(message: Message): string {
  if (isGroupSafeMessage(message)) return message.text;
  return "[private message withheld from group response context]";
}
