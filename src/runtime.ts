import { randomBytes, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { createConversations } from './conversations.ts';
import { createInbox } from './inbox.ts';
import { LIMITS, type Clock } from './limits.ts';
import type { PeerHost } from './pi-adapter.ts';
import { cleanName, parseEnvelope, ProtocolError, samePeer, type Ack, type Delivery, type Envelope, type MessageEnvelope, type PeerIdentity, type PeerRecord, type PeerView, type ReceiptEnvelope, type Transmission } from './protocol.ts';
import { configuredPaths, createRegistry, privateDir, processStart, type Registry } from './registry.ts';
import { listenPeer, probePeer, sendFrame, type PeerServer } from './transport.ts';

export type SendInput = { to: string; text?: string; kind?: 'request' | 'notification'; delivery?: Delivery; notifyWhenIdle?: boolean };
export type ReplyInput = { messageId: string; text: string; outcome?: 'ok' | 'error'; delivery?: Delivery };
export type SendResult = { message?: Transmission; subscription?: { id: string; status: string } };
export function createRuntime(options: { identity: PeerIdentity; cwd: string; agentDir: string; clock: Clock; host: PeerHost }) {
  const { cwd, agentDir, clock, host } = options;
  const self = { ...options.identity, name: cleanName(options.identity.name) };
  const inbox = createInbox(clock), conversations = createConversations(self, clock);
  const lifetime = new AbortController(), controlLifetime = new AbortController();
  let state: 'starting' | 'active' | 'closing' | 'closed' = 'starting', paused = false;
  let registry: Registry | undefined, server: PeerServer | undefined, boot: Promise<void> | undefined, stopped: Promise<void> | undefined;
  let sweep: ReturnType<typeof setInterval> | undefined, noticeTimer: ReturnType<typeof setTimeout> | undefined;
  const notices = new Set<string>(), controls = new Set<Promise<void>>();
  const record: PeerRecord = { ...self, version: 1, pid: process.pid, cwd, endpoint: '', features: [] };
  const assertActive = () => { if (state !== 'active') throw new ProtocolError('unavailable'); };
  const info = (): PeerView => ({ ...record, activity: host.isIdle() && !host.hasPendingMessages() && !inbox.hasPending() ? 'idle' : 'busy', paused: paused || state !== 'active' });
  async function discover(): Promise<PeerView[]> {
    if (!registry) return [];
    return registry.discover(async r => probePeer(r, await registry!.readToken(r.instanceId)));
  }
  async function transmit(frame: Envelope, signal?: AbortSignal, control = false): Promise<Transmission> {
    try {
      const peer = (await discover()).find(p => samePeer(p, frame.to));
      if (!peer) return { messageId: frame.messageId, status: 'unavailable', code: 'unavailable' };
      const localSignal = control ? controlLifetime.signal : lifetime.signal;
      if (localSignal.aborted || signal?.aborted) return { messageId: frame.messageId, status: 'unavailable', code: 'cancelled' };
      return await sendFrame(peer, await registry!.readToken(peer.instanceId), frame, signal ? AbortSignal.any([localSignal, signal]) : localSignal);
    } catch { return { messageId: frame.messageId, status: 'unavailable', code: 'unavailable' }; }
  }
  function control(frame: Envelope) {
    if (controls.size >= LIMITS.controls || state === 'closed') return;
    const job = transmit(frame, undefined, true).then(() => {}, () => {}).finally(() => controls.delete(job));
    controls.add(job);
  }
  function receipt(m: MessageEnvelope, receiptState: ReceiptEnvelope['state']) {
    control({ version: 1, kind: 'receipt', messageId: randomUUID(), from: { ...self }, to: m.from, originalMessageId: m.messageId, state: receiptState });
  }
  function notice(text: string) {
    if (state !== 'active') return;
    if (notices.size < LIMITS.controls) notices.add(text);
    if (!noticeTimer) noticeTimer = setTimeout(() => {
      noticeTimer = undefined;
      const text = [...notices].join('\n'); notices.clear();
      if (text && state === 'active') host.notice(text, !paused);
    }, 500);
  }
  function submit(m: MessageEnvelope) {
    if (state !== 'active' || paused) return;
    inbox.markSubmitted(m.messageId);
    try { host.inject(m); receipt(m, 'submitted'); }
    catch { inbox.drop(m.messageId); receipt(m, 'dropped'); }
  }
  function pump() {
    if (state !== 'active' || paused) return;
    for (const m of inbox.expire()) receipt(m, 'expired');
    let m: MessageEnvelope | undefined;
    while ((m = inbox.take('steer'))) submit(m);
    if (host.isIdle() && !host.hasPendingMessages()) { m = inbox.take('followUp'); if (m) submit(m); }
  }
  async function onFrame(frame: Envelope): Promise<Ack> {
    assertActive();
    if (!samePeer(frame.to, self)) throw new ProtocolError('stale_target');
    if (samePeer(frame.from, self)) throw new ProtocolError('self_target');
    const ack: Ack = { messageId: frame.messageId, status: 'accepted' };
    if (frame.kind === 'receipt') {
      const before = conversations.getStatus(frame.originalMessageId)[0]?.delivery;
      conversations.applyReceipt(frame);
      const after = conversations.getStatus(frame.originalMessageId)[0]?.delivery;
      if (before !== after && (after === 'expired' || after === 'dropped')) notice('Peer request ' + frame.originalMessageId + ': ' + after + '. Do not automatically retry.');
      return ack;
    }
    if (frame.kind === 'idle-subscribe' || frame.kind === 'idle-notice') throw new ProtocolError('unsupported_feature');
    const duplicate = inbox.lookupDuplicate(frame); if (duplicate) return duplicate;
    conversations.validateIncoming(frame);
    const admitted = inbox.admit(frame);
    if (admitted.status === 'accepted') { conversations.recordIncoming(frame); queueMicrotask(pump); }
    return admitted;
  }
  const runtime = {
    info,
    start(): Promise<void> {
      if (boot) return boot;
      boot = (async () => {
        try {
          if (state !== 'starting') throw new ProtocolError('closed');
          const paths = await configuredPaths(agentDir); registry = createRegistry(paths);
          await privateDir(paths.socketDir);
          record.endpoint = join(paths.socketDir, self.instanceId.slice(0, 16) + '.sock');
          record.processStart = await processStart(process.pid);
          if (state !== 'starting') throw new ProtocolError('closed');
          const token = randomBytes(32).toString('hex');
          server = await listenPeer({ record, token, getView: info, onFrame });
          if (state !== 'starting') throw new ProtocolError('closed');
          await registry.publish(record, token);
          if (state !== 'starting') throw new ProtocolError('closed');
          state = 'active';
          sweep = setInterval(() => {
            if (state !== 'active') return;
            for (const m of inbox.expire()) receipt(m, 'expired');
            for (const status of conversations.expire()) notice('Reply wait expired for ' + status.messageId + '; the remote action may have executed. Do not automatically retry.');
          }, 1000); sweep.unref();
        } catch (error) {
          await server?.close(); await registry?.removeOwn(self.instanceId);
          state = 'closed'; throw error;
        }
      })();
      return boot;
    },
    close(): Promise<void> {
      if (stopped) return stopped;
      state = 'closing'; lifetime.abort(); clearInterval(sweep); clearTimeout(noticeTimer); notices.clear();
      stopped = (async () => {
        await boot?.catch(() => {});
        await registry?.removeOwn(self.instanceId);
        for (const m of inbox.drain()) receipt(m, 'expired');
        await server?.close();
        let timer: ReturnType<typeof setTimeout> | undefined;
        await Promise.race([Promise.allSettled([...controls]), new Promise<void>(resolve => { timer = setTimeout(resolve, 1000); })]);
        clearTimeout(timer); controlLifetime.abort(); await Promise.allSettled([...controls]);
        conversations.clear(); state = 'closed';
      })();
      return stopped;
    },
    async list() { assertActive(); const peers = await discover(); assertActive(); return peers.filter(p => !samePeer(p, self)); },
    async send(input: SendInput, signal?: AbortSignal): Promise<SendResult> {
      assertActive();
      if (!input.text?.trim()) throw new ProtocolError('empty_text');
      if (input.notifyWhenIdle) throw new ProtocolError('unsupported_feature');
      const target = registry!.resolve(input.to, await runtime.list()); assertActive();
      const m: MessageEnvelope = { version: 1, messageId: randomUUID(), kind: input.kind ?? 'request', from: { ...self }, to: { sessionId: target.sessionId, instanceId: target.instanceId, name: target.name }, text: input.text, delivery: input.delivery ?? 'followUp', createdAt: clock.now() };
      parseEnvelope(m); conversations.recordOutgoing(m);
      const result = await transmit(m, signal); if (state === 'active') conversations.recordTransmission(m.messageId, result);
      return { message: result };
    },
    async reply(input: ReplyInput, signal?: AbortSignal): Promise<Transmission> {
      assertActive();
      const m = conversations.makeReply(input.messageId, input.text, input.outcome ?? 'ok', input.delivery ?? 'followUp');
      const result = await transmit(m, signal); if (state === 'active') conversations.recordTransmission(m.messageId, result);
      return result;
    },
    status(id?: string) { return conversations.getStatus(id); },
    pause() { if (state !== 'active') return; paused = true; inbox.setPaused(true); },
    resume() { if (state !== 'active') return; paused = false; inbox.setPaused(false); pump(); },
    async rename(name: string) { assertActive(); self.name = record.name = cleanName(name); await registry!.updateName(self.instanceId, self.name); },
    onSettled(aborted: boolean) {
      if (state !== 'active') return;
      if (aborted) { runtime.pause(); host.notice('Peer intake paused after abort. Use /peers resume to continue.', false); }
      else pump();
    },
    observeContext(ids: string[]) { if (state === 'active') inbox.observeContext(ids); },
  };
  return runtime;
}
export type PeerRuntime = ReturnType<typeof createRuntime>;
