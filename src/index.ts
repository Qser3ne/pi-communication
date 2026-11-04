import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import { getAgentDir, VERSION, type ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { createPiHost, observedPeerIds } from './pi-adapter.ts';
import { createRuntime, type PeerRuntime } from './runtime.ts';

export default function peerCommunication(pi: ExtensionAPI) {
  let runtime: PeerRuntime | undefined;
  pi.on('session_start', async (_event, ctx) => {
    if (process.platform !== 'linux' && process.platform !== 'darwin') throw new Error('pi-communication supports Linux/macOS only');
    const [major=0,minor=0] = VERSION.split('.').map(Number);
    if (major < 1 || (major === 1 && minor < 5)) throw new Error('pi-communication requires Pi >=1.5.0');
    await runtime?.close();
    const current = createRuntime({ identity: { sessionId: ctx.sessionManager.getSessionId(), instanceId: randomUUID(), name: ctx.sessionManager.getSessionName() ?? basename(ctx.cwd) }, cwd: ctx.cwd, agentDir: getAgentDir(), clock: Date, host: createPiHost(pi, ctx) });
    runtime = current;
    try { await current.start(); } catch (error) { if (runtime === current) runtime = undefined; throw error; }
  });
  pi.on('session_shutdown', async () => { const old = runtime; runtime = undefined; await old?.close(); });
  pi.on('session_info_changed', async (event, ctx) => { await runtime?.rename(event.name ?? basename(ctx.cwd)); });
  pi.on('agent_start', () => runtime?.onBusy());
  pi.on('agent_settled', event => runtime?.onSettled(event.aborted));
  pi.on('context', event => { if (runtime) runtime.observeContext(observedPeerIds(event.messages, runtime.info().instanceId)); });
}
