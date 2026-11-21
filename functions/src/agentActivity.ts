type ActivityStamp = { createdAt?: number; updatedAt?: number; agentAt?: number };

export function agentEdit(uid: string, now: number, before?: ActivityStamp) {
  // A fresh marker distinguishes this write even if two edits share a clock tick.
  const next = Math.max(now, (before?.agentAt ?? 0) + 1);
  const at = next === before?.updatedAt ? next + 1 : next;
  return { agentAt: at, updatedAt: at, updatedBy: uid };
}

export function agentAttribution(before: ActivityStamp | null, after: ActivityStamp | null) {
  const stamp = before ? after?.updatedAt : after?.createdAt;
  if (after?.agentAt !== undefined && after.agentAt === stamp && after.agentAt !== before?.agentAt) {
    return { via: 'agent' as const };
  }
  return {};
}
