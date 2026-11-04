import { randomUUID } from 'node:crypto';
import { LIMITS, type Clock } from './limits.ts';
import { parseEnvelope, ProtocolError, samePeer, type Delivery, type MessageEnvelope, type PeerIdentity, type ReceiptEnvelope, type RequestStatus, type Transmission } from './protocol.ts';

type Entry = { message: MessageEnvelope; direction: 'in' | 'out'; at: number; status: RequestStatus; reply?: { message: MessageEnvelope; status: RequestStatus } };
const newStatus = (m: MessageEnvelope, incoming = false): RequestStatus => ({ messageId: m.messageId, delivery: incoming ? 'accepted' : 'sending', response: m.kind === 'request' ? 'pending' : 'not_expected' });
const light = (m: MessageEnvelope): MessageEnvelope => ({ ...structuredClone(m), text: '' });
export function createConversations(self: PeerIdentity, clock: Clock) {
  const records = new Map<string, Entry>();
  const live = (e: Entry | undefined): e is Entry => !!e && clock.now() - e.at < LIMITS.conversationMs;
  function reserve(m: MessageEnvelope, direction: 'in' | 'out') {
    if (records.has(m.messageId)) throw new ProtocolError('id_conflict');
    if (records.size >= LIMITS.conversations) throw new ProtocolError('capacity');
    records.set(m.messageId, { message: light(m), direction, at: clock.now(), status: newStatus(m, direction === 'in') });
  }
  function find(id: string): { entry: Entry; status: RequestStatus; message: MessageEnvelope } | undefined {
    const e = records.get(id); if (live(e)) return { entry: e, status: e.status, message: e.message };
    for (const parent of records.values()) if (live(parent) && parent.reply?.message.messageId === id) return { entry: parent, ...parent.reply };
  }
  function validateIncoming(m: MessageEnvelope) {
    if (!samePeer(m.to, self)) throw new ProtocolError('stale_target');
    if (m.kind === 'reply') {
      const e = records.get(m.replyTo);
      if (!live(e) || e.direction !== 'out' || e.message.kind !== 'request' || e.status.response !== 'pending' || !samePeer(m.from, e.message.to)) throw new ProtocolError('bad_reply');
    } else if (m.kind === 'request') {
      if (records.has(m.messageId)) throw new ProtocolError('id_conflict');
      if (records.size >= LIMITS.conversations) throw new ProtocolError('capacity');
    }
  }
  function recordOutgoing(m: MessageEnvelope) {
    if (!samePeer(m.from, self)) throw new ProtocolError('invalid_sender');
    if (m.kind !== 'reply') return reserve(m, 'out');
    const e = records.get(m.replyTo);
    if (!live(e) || e.direction !== 'in' || e.message.kind !== 'request' || !samePeer(m.to, e.message.from) || (e.reply && e.reply.message.messageId !== m.messageId)) throw new ProtocolError('bad_reply');
    e.reply ??= { message: light(m), status: newStatus(m) };
  }
  return {
    validateIncoming, recordOutgoing,
    recordIncoming(m: MessageEnvelope) {
      validateIncoming(m);
      if (m.kind === 'request') reserve(m, 'in');
      if (m.kind === 'reply') {
        const e = records.get(m.replyTo)!;
        e.status.response = 'replied'; e.status.replyMessageId = m.messageId; e.status.outcome = m.outcome;
      }
    },
    recordTransmission(id: string, result: Transmission) {
      const found = find(id); if (!found) return;
      const { status, entry, message } = found;
      if (status.delivery === 'sending' || status.delivery === 'unknown') status.delivery = result.status;
      if (message.kind === 'reply' && result.status === 'accepted') {
        entry.status.response = 'replied'; entry.status.replyMessageId = id; entry.status.outcome = message.outcome;
      }
    },
    applyReceipt(receipt: ReceiptEnvelope) {
      const found = find(receipt.originalMessageId);
      if (!found || !samePeer(receipt.to, self) || !samePeer(receipt.from, found.message.to)) return;
      const status = found.status;
      if (status.delivery === 'rejected' || status.delivery === 'unavailable' || status.delivery === 'dropped' || status.delivery === 'expired') return;
      status.delivery = receipt.state;
    },
    makeReply(id: string, text: string, outcome: 'ok' | 'error', delivery: Delivery): MessageEnvelope {
      const e = records.get(id);
      if (!live(e) || e.direction !== 'in' || e.message.kind !== 'request' || e.reply) throw new ProtocolError('bad_reply');
      const m: MessageEnvelope = { version: 1, messageId: randomUUID(), kind: 'reply', from: { ...self }, to: e.message.from, text, delivery, createdAt: clock.now(), replyTo: id, outcome };
      parseEnvelope(m); recordOutgoing(m); return m;
    },
    getStatus(id?: string): RequestStatus[] {
      if (id) { const found = find(id); return found ? [{ ...found.status }] : []; }
      return [...records.values()].filter(live).map(e => ({ ...e.status }));
    },
    expire(): RequestStatus[] {
      const expired: RequestStatus[] = [];
      for (const [id, e] of records) if (clock.now() - e.at >= LIMITS.conversationMs) {
        if (e.status.response === 'pending') expired.push({ ...e.status, response: 'expired' });
        records.delete(id);
      }
      return expired;
    },
    clear() { records.clear(); },
  };
}
export type Conversations = ReturnType<typeof createConversations>;
