import { createHash } from 'node:crypto';
import { LIMITS, type Clock } from './limits.ts';
import type { Ack, Delivery, MessageEnvelope } from './protocol.ts';

type Pending = { message: MessageEnvelope; at: number; phase: 'queued' | 'taken' | 'submitted' };
function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => JSON.stringify(k) + ':' + canonical(v)).join(',') + '}';
  return JSON.stringify(value);
}
export function createInbox(clock: Clock) {
  const pending = new Map<string, Pending>();
  const seen = new Map<string, { hash: string; at: number; ack: Ack }>();
  const rates = new Map<string, number[]>(); let paused = false;
  const key = (m: MessageEnvelope) => `${m.from.instanceId}:${m.messageId}`;
  const hash = (m: MessageEnvelope) => createHash('sha256').update(canonical(m)).digest('hex');
  function prune() {
    const now = clock.now();
    for (const [k, v] of seen) if (now - v.at >= LIMITS.dedupMs && !pending.has(k)) seen.delete(k);
    for (const [k, times] of rates) { const recent = times.filter(t => now - t < LIMITS.rateMs); if (recent.length) rates.set(k, recent); else rates.delete(k); }
  }
  function lookupDuplicate(message: MessageEnvelope): Ack | undefined {
    prune(); const old = seen.get(key(message));
    if (old) return old.hash === hash(message) ? { ...old.ack } : { messageId: message.messageId, status: 'rejected', code: 'id_conflict' };
  }
  return {
    lookupDuplicate,
    admit(message: MessageEnvelope): Ack {
      const duplicate = lookupDuplicate(message); if (duplicate) return duplicate;
      const reject = (code: string): Ack => ({ messageId: message.messageId, status: 'rejected', code });
      if (paused) return reject('paused');
      if ([...pending.values()].some(p => p.message.messageId === message.messageId)) return reject('id_conflict');
      if (pending.size >= LIMITS.inbox) return reject('queue_full');
      if (seen.size >= LIMITS.dedup) return reject('capacity');
      const times = rates.get(message.from.instanceId) ?? [];
      if (times.length >= LIMITS.rate) return reject('rate_limited');
      const at = clock.now(), ack: Ack = { messageId: message.messageId, status: 'accepted' };
      pending.set(key(message), { message: structuredClone(message), at, phase: 'queued' });
      seen.set(key(message), { hash: hash(message), at, ack });
      rates.set(message.from.instanceId, [...times, at]); return { ...ack };
    },
    take(delivery: Delivery): MessageEnvelope | undefined {
      if (paused) return;
      for (const p of pending.values()) if (p.phase === 'queued' && p.message.delivery === delivery) { p.phase = 'taken'; return structuredClone(p.message); }
    },
    markSubmitted(messageId: string) { for (const p of pending.values()) if (p.message.messageId === messageId && p.phase === 'taken') p.phase = 'submitted'; },
    observeContext(ids: string[]) { const set = new Set(ids); for (const [k, p] of pending) if (p.phase === 'submitted' && set.has(p.message.messageId)) pending.delete(k); },
    setPaused(value: boolean) { paused = value; },
    expire(): MessageEnvelope[] {
      const expired: MessageEnvelope[] = [];
      for (const [k, p] of pending) if (p.phase !== 'submitted' && clock.now() - p.at >= LIMITS.queueMs) { expired.push(p.message); pending.delete(k); }
      prune(); return expired;
    },
    drop(messageId: string) { for (const [k, p] of pending) if (p.message.messageId === messageId) pending.delete(k); },
    drain(): MessageEnvelope[] { const rest = [...pending.values()].filter(p => p.phase !== 'submitted').map(p => p.message); pending.clear(); seen.clear(); rates.clear(); return rest; },
    hasPending() { return pending.size > 0; },
  };
}
export type Inbox = ReturnType<typeof createInbox>;
