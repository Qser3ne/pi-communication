import { randomUUID } from 'node:crypto';
export const identity = (name = 'peer') => ({ sessionId: randomUUID(), instanceId: randomUUID(), name });
export const message = (patch: Record<string, unknown> = {}) => ({ version: 1 as const, messageId: randomUUID(), kind: 'request' as const, from: identity('A'), to: identity('B'), text: 'review this', delivery: 'followUp' as const, createdAt: Date.now(), ...patch });
