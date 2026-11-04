import { createConnection, createServer, type Socket } from 'node:net';
import { chmod, lstat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import { Check } from 'typebox/value';
import { LIMITS } from './limits.ts';
import { encodeFrame, IdentitySchema, parseEnvelope, parseRecord, ProtocolError, samePeer, type Ack, type Envelope, type PeerIdentity, type PeerRecord, type PeerView, type Transmission } from './protocol.ts';
import { privateDir, validateEndpoint } from './registry.ts';

export type PeerServer = { close(): Promise<void> };
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const identity = (p: PeerIdentity): PeerIdentity => ({ sessionId: p.sessionId, instanceId: p.instanceId, name: p.name });
function lines(socket: Socket, onLine: (value: unknown) => void): void {
  const decoder = new TextDecoder('utf-8', { fatal: true }); let buffer: Buffer = Buffer.alloc(0);
  socket.on('data', chunk => {
    buffer = Buffer.concat([buffer, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)]);
    let end: number;
    while ((end = buffer.indexOf(10)) >= 0) {
      const line = buffer.subarray(0, end); buffer = buffer.subarray(end + 1);
      if (line.length + 1 > LIMITS.frameBytes) { socket.destroy(); return; }
      try { onLine(JSON.parse(decoder.decode(line))); } catch { socket.destroy(); return; }
      if (socket.destroyed) return;
    }
    if (buffer.length >= LIMITS.frameBytes) socket.destroy();
  });
  socket.on('end', () => { if (buffer.length) socket.destroy(); });
}
export async function listenPeer(options: { record: PeerRecord; token: string; onFrame: (frame: Envelope) => Promise<Ack>; getView: () => PeerView }): Promise<PeerServer> {
  const { record, token, onFrame, getView } = options;
  await privateDir(dirname(record.endpoint));
  try { await lstat(record.endpoint); throw new ProtocolError('endpoint_exists'); }
  catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
  if (!/^[0-9a-f]{64}$/.test(token)) throw new ProtocolError('invalid_token');
  const clients = new Set<Socket>(); let closing = false;
  const server = createServer(socket => {
    if (closing || clients.size >= LIMITS.connections) { socket.destroy(); return; }
    clients.add(socket);
    const timer = setTimeout(() => socket.destroy(), LIMITS.timeoutMs); timer.unref();
    socket.on('error', () => {});
    socket.on('close', () => { clearTimeout(timer); clients.delete(socket); });
    let stage: 'hello' | 'message' | 'done' = 'hello'; let from: PeerIdentity | undefined;
    lines(socket, raw => {
      if (stage === 'hello') {
        if (!object(raw) || raw.kind !== 'hello' || raw.version !== 1 || typeof raw.token !== 'string' || !/^[0-9a-f]{64}$/.test(raw.token) || !timingSafeEqual(Buffer.from(raw.token), Buffer.from(token)) || !Check(IdentitySchema, raw.to) || !samePeer(raw.to, record)) { socket.destroy(); return; }
        if (raw.operation !== 'probe' && raw.operation !== 'send') { socket.destroy(); return; }
        if (raw.operation === 'send') {
          if (!Check(IdentitySchema, raw.from)) { socket.destroy(); return; }
          from = raw.from; stage = 'message';
          socket.write(encodeFrame({ kind: 'ready', version: 1, view: getView() }));
        } else { stage = 'done'; socket.end(encodeFrame({ kind: 'ready', version: 1, view: getView() })); }
        return;
      }
      if (stage !== 'message') { socket.destroy(); return; }
      stage = 'done';
      const frame = parseEnvelope(raw);
      if (!samePeer(frame.to, record) || !from || !samePeer(frame.from, from)) { socket.destroy(); return; }
      void onFrame(frame).then(ack => { if (!socket.destroyed) socket.end(encodeFrame(ack)); }, error => {
        if (!socket.destroyed) socket.end(encodeFrame({ messageId: frame.messageId, status: 'rejected', code: error instanceof ProtocolError ? error.code : 'internal_error' }));
      });
    });
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(record.endpoint, () => { server.removeListener('error', reject); resolve(); }); });
  server.on('error', () => {});
  try { await chmod(record.endpoint, 0o600); } catch (e) { server.close(); throw e; }
  let stopped: Promise<void> | undefined;
  return { close() {
    if (stopped) return stopped;
    closing = true; for (const client of clients) client.destroy();
    stopped = new Promise<void>(resolve => server.close(() => resolve())); return stopped;
  } };
}
async function exchange(record: PeerRecord, token: string, frame: Envelope | undefined, timeoutMs: number, signal?: AbortSignal): Promise<PeerView | Transmission> {
  let mayHaveSent = false;
  const failure = (code: string): Transmission => ({ messageId: frame?.messageId ?? '', status: mayHaveSent ? 'unknown' : 'unavailable', code });
  if (signal?.aborted) return failure('cancelled');
  try { await validateEndpoint(record.endpoint); if (frame) parseEnvelope(frame); } catch { return failure('invalid_endpoint_or_frame'); }
  if (signal?.aborted) return failure('cancelled');
  return new Promise(resolve => {
    const socket = createConnection(record.endpoint); let done = false; let ready = false;
    const finish = (value: PeerView | Transmission) => {
      if (done) return; done = true; clearTimeout(timer); signal?.removeEventListener('abort', abort); socket.destroy(); resolve(value);
    };
    const abort = () => finish(failure('cancelled'));
    const timer = setTimeout(() => finish(failure('timeout')), timeoutMs); timer.unref();
    signal?.addEventListener('abort', abort, { once: true });
    socket.on('error', () => finish(failure('connection_failed')));
    socket.on('close', () => finish(failure('connection_closed')));
    socket.once('connect', () => {
      if (signal?.aborted) return abort();
      socket.write(encodeFrame({ version: 1, kind: 'hello', token, to: identity(record), ...(frame ? { from: identity(frame.from) } : {}), operation: frame ? 'send' : 'probe' }));
    });
    lines(socket, raw => {
      if (!object(raw)) throw new ProtocolError('invalid_frame');
      if (!ready) {
        if (raw.kind !== 'ready' || raw.version !== 1 || !object(raw.view)) throw new ProtocolError('invalid_handshake');
        const { activity, paused, ...fields } = raw.view;
        const peer = parseRecord(fields);
        if (!samePeer(peer, record) || (activity !== 'idle' && activity !== 'busy') || typeof paused !== 'boolean') throw new ProtocolError('stale_target');
        ready = true;
        if (!frame) return finish({ ...peer, activity, paused });
        mayHaveSent = true; socket.write(encodeFrame(frame)); return;
      }
      if (!frame || raw.messageId !== frame.messageId || (raw.status !== 'accepted' && raw.status !== 'rejected') || (raw.code !== undefined && (typeof raw.code !== 'string' || raw.code.length > 128))) throw new ProtocolError('invalid_ack');
      finish({ messageId: frame.messageId, status: raw.status, ...(typeof raw.code === 'string' ? { code: raw.code } : {}) });
    });
  });
}
export async function sendFrame(record: PeerRecord, token: string, frame: Envelope, signal?: AbortSignal): Promise<Transmission> {
  const result = await exchange(record, token, frame, LIMITS.timeoutMs, signal);
  if ('messageId' in result) return result;
  throw new ProtocolError('invalid_ack');
}
export async function probePeer(record: PeerRecord, token: string, timeoutMs = 300): Promise<PeerView> {
  const result = await exchange(record, token, undefined, timeoutMs);
  if ('instanceId' in result) return result;
  throw new ProtocolError(result.code ?? 'unavailable');
}
