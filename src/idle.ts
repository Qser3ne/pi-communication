import { randomUUID } from 'node:crypto';
import { LIMITS, type Clock } from './limits.ts';
import { ProtocolError, samePeer, type IdleEnvelope, type PeerIdentity } from './protocol.ts';
type Subscription = Extract<IdleEnvelope, { kind: 'idle-subscribe' }>;
type Notice = Extract<IdleEnvelope, { kind: 'idle-notice' }>;
export function createIdleSubscriptions(self: PeerIdentity, clock: Clock) {
  const incoming = new Map<string, { frame: Subscription; at: number }>();
  const outgoing = new Map<string, { frame: Subscription; at: number }>();
  const makeNotice = (sub: Subscription, state: Notice['state'], from: PeerIdentity, to: PeerIdentity): Notice => ({ version: 1, kind: 'idle-notice', messageId: randomUUID(), from: { ...from }, to: { ...to }, subscriptionId: sub.subscriptionId, state });
  return {
    subscribe(target: PeerIdentity): Subscription {
      if (samePeer(self, target)) throw new ProtocolError('self_target');
      if (!outgoing.has(target.instanceId) && outgoing.size >= LIMITS.idle) throw new ProtocolError('capacity');
      const frame: Subscription = { version: 1, kind: 'idle-subscribe', messageId: randomUUID(), subscriptionId: randomUUID(), from: { ...self }, to: { ...target } };
      outgoing.set(target.instanceId, { frame, at: clock.now() }); return frame;
    },
    accept(frame: IdleEnvelope) {
      if (frame.kind !== 'idle-subscribe' || !samePeer(frame.to, self) || samePeer(frame.from, self)) throw new ProtocolError('invalid_subscription');
      if (!incoming.has(frame.from.instanceId) && incoming.size >= LIMITS.idle) throw new ProtocolError('capacity');
      incoming.set(frame.from.instanceId, { frame: structuredClone(frame), at: clock.now() });
    },
    takeNotices(state: 'idle' | 'exited', eligible: boolean): Notice[] {
      if (!eligible) return [];
      const notices = [...incoming.values()].map(({frame,at}) => makeNotice(frame, clock.now() - at >= LIMITS.idleMs ? 'expired' : state, self, frame.from));
      incoming.clear(); return notices;
    },
    receive(frame: IdleEnvelope): boolean {
      if (frame.kind !== 'idle-notice' || !samePeer(frame.to, self)) return false;
      const old = outgoing.get(frame.from.instanceId);
      if (!old || old.frame.subscriptionId !== frame.subscriptionId || !samePeer(old.frame.to, frame.from) || clock.now() - old.at >= LIMITS.idleMs) return false;
      outgoing.delete(frame.from.instanceId); return true;
    },
    cancel(subscriptionId: string) { for (const [id, value] of outgoing) if (value.frame.subscriptionId === subscriptionId) outgoing.delete(id); },
    expire(): Notice[] {
      const result: Notice[] = [];
      for (const [id, value] of incoming) if (clock.now() - value.at >= LIMITS.idleMs) { result.push(makeNotice(value.frame, 'expired', self, value.frame.from)); incoming.delete(id); }
      for (const [id, value] of outgoing) if (clock.now() - value.at >= LIMITS.idleMs) { result.push(makeNotice(value.frame, 'expired', value.frame.to, self)); outgoing.delete(id); }
      return result;
    },
    clear() { incoming.clear(); outgoing.clear(); },
  };
}
export type IdleSubscriptions = ReturnType<typeof createIdleSubscriptions>;
