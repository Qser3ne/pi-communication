import { constants, realpathSync } from 'node:fs';
import { lstat, mkdir, open, readFile, readdir, rename, unlink, link } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { cleanName, parseRecord, ProtocolError, samePeer, type PeerRecord, type PeerView } from './protocol.ts';

export type RegistryPaths = { root: string; sessionsDir: string; keysDir: string; socketDir: string };
const validId = (id: string) => /^[0-9a-f]{8}-[0-9a-f-]{27}$/.test(id);
export function resolvePaths(agentDir: string, configRoot?: string): RegistryPaths {
  const root = configRoot ?? join(agentDir, 'communication');
  if (!isAbsolute(root)) throw new ProtocolError('unsafe_path');
  const hash = createHash('sha256').update(root).digest('hex').slice(0, 12);
  const socketDir = join(realpathSync('/tmp'), `pi-peer-${process.getuid?.() ?? 0}-${hash}`);
  return { root, sessionsDir: join(root, 'sessions'), keysDir: join(root, 'keys'), socketDir };
}
export async function assertNoSymlinks(path: string): Promise<void> {
  let current = resolve(path);
  while (true) {
    try { if ((await lstat(current)).isSymbolicLink()) throw new ProtocolError('unsafe_path'); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
    const parent = dirname(current); if (parent === current) return; current = parent;
  }
}
export async function privateDir(path: string): Promise<void> {
  await assertNoSymlinks(path);
  await mkdir(path, { recursive: true, mode: 0o700 });
  const s = await lstat(path);
  if (!s.isDirectory() || s.uid !== process.getuid?.() || (s.mode & 0o077)) throw new ProtocolError('unsafe_path');
}
export async function readPrivate(path: string, max: number): Promise<string> {
  await assertNoSymlinks(path);
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const s = await handle.stat();
    if (!s.isFile() || s.uid !== process.getuid?.() || (s.mode & 0o077) || s.size > max) throw new ProtocolError('unsafe_path');
    const bytes = Buffer.alloc(max + 1);
    const { bytesRead } = await handle.read(bytes, 0, max + 1, 0);
    if (bytesRead > max) throw new ProtocolError('unsafe_path');
    return bytes.subarray(0, bytesRead).toString('utf8');
  } finally { await handle.close(); }
}
export async function validateEndpoint(endpoint: string): Promise<void> {
  if (!isAbsolute(endpoint) || !endpoint.endsWith('.sock') || Buffer.byteLength(endpoint) > 103) throw new ProtocolError('unsafe_path');
  await assertNoSymlinks(endpoint);
  const [s, p] = await Promise.all([lstat(endpoint), lstat(dirname(endpoint))]);
  if (!s.isSocket() || s.uid !== process.getuid?.() || (s.mode & 0o077) || !p.isDirectory() || p.uid !== process.getuid?.() || (p.mode & 0o077)) throw new ProtocolError('unsafe_path');
}
export async function processStart(pid: number): Promise<string | undefined> {
  if (process.platform !== 'linux') return;
  try { const s = await readFile(`/proc/${pid}/stat`, 'utf8'); return s.slice(s.lastIndexOf(')') + 2).split(' ')[19]; } catch { return; }
}
export async function configuredPaths(agentDir: string): Promise<RegistryPaths> {
  try {
    const config: unknown = JSON.parse(await readPrivate(join(agentDir, 'communication', 'config.json'), 4096));
    if (!config || typeof config !== 'object' || !('registryRoot' in config) || typeof config.registryRoot !== 'string') throw new ProtocolError('invalid_config');
    return resolvePaths(agentDir, config.registryRoot);
  } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return resolvePaths(agentDir); throw e; }
}
export function createRegistry(paths: RegistryPaths) {
  const owned = new Map<string, number>();
  let updates = Promise.resolve();
  const pathFor = (dir: string, id: string) => { if (!validId(id)) throw new ProtocolError('invalid_id'); return join(dir, `${id}.json`); };
  async function atomic(path: string, value: unknown, replacing = false) {
    const temp = `${path}.${randomUUID()}.tmp`;
    const h = await open(temp, 'wx', 0o600);
    try { await h.writeFile(JSON.stringify(value)); } finally { await h.close(); }
    try {
      if (replacing) {
        if ((await lstat(path)).ino !== owned.get(path)) throw new ProtocolError('ownership_changed');
        await rename(temp, path);
      } else await link(temp, path); // Atomic create without overwriting another instance.
      owned.set(path, (await lstat(path)).ino);
    } finally { await unlink(temp).catch(() => {}); }
  }
  async function removeOwn(id: string) {
    await updates;
    for (const dir of [paths.sessionsDir, paths.keysDir]) {
      const path = pathFor(dir, id), ino = owned.get(path);
      if (ino === undefined) continue;
      try { if ((await lstat(path)).ino === ino) await unlink(path); }
      catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
      finally { owned.delete(path); }
    }
  }
  return {
    async publish(record: PeerRecord, token: string) {
      parseRecord(record);
      if (!/^[0-9a-f]{64}$/.test(token)) throw new ProtocolError('invalid_token');
      for (const dir of [paths.root, paths.sessionsDir, paths.keysDir, paths.socketDir]) await privateDir(dir);
      try {
        await atomic(pathFor(paths.keysDir, record.instanceId), { token });
        await atomic(pathFor(paths.sessionsDir, record.instanceId), { ...record, name: cleanName(record.name) });
      } catch (e) { await removeOwn(record.instanceId); throw e; }
    },
    updateName(id: string, name: string) {
      const job = updates.then(async () => {
        const path = pathFor(paths.sessionsDir, id);
        const record = parseRecord(JSON.parse(await readPrivate(path, 65536)));
        await atomic(path, { ...record, name: cleanName(name) }, true);
      });
      updates = job.catch(() => {}); return job;
    },
    async readToken(id: string): Promise<string> {
      const data: unknown = JSON.parse(await readPrivate(pathFor(paths.keysDir, id), 4096));
      if (!data || typeof data !== 'object' || !('token' in data) || typeof data.token !== 'string' || !/^[0-9a-f]{64}$/.test(data.token)) throw new ProtocolError('invalid_token');
      return data.token;
    },
    async discover(probe: (record: PeerRecord) => Promise<PeerView>): Promise<PeerView[]> {
      await privateDir(paths.root); await privateDir(paths.sessionsDir);
      const files = await readdir(paths.sessionsDir), result: PeerView[] = [];
      let next = 0;
      await Promise.all(Array.from({ length: Math.min(8, files.length) }, async () => {
        while (next < files.length) {
          const file = files[next++]!;
          if (!file.endsWith('.json') || !validId(file.slice(0, -5))) continue;
          let timer: ReturnType<typeof setTimeout> | undefined;
          try {
            const record = parseRecord(JSON.parse(await readPrivate(join(paths.sessionsDir, file), 65536)));
            if (`${record.instanceId}.json` !== file) continue;
            process.kill(record.pid, 0);
            if (record.processStart && record.processStart !== await processStart(record.pid)) continue;
            await validateEndpoint(record.endpoint);
            const view = await Promise.race([probe(record), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('probe_timeout')), 300); })]);
            if (samePeer(record, view)) result.push({ ...record, activity: view.activity, paused: view.paused });
          } catch { /* Invalid/dead peers are not discoverable; never trust stale files. */ }
          finally { clearTimeout(timer); }
        }
      }));
      return result.sort((a, b) => a.name.localeCompare(b.name) || a.instanceId.localeCompare(b.instanceId));
    },
    resolve(to: string, peers: PeerView[]): PeerView {
      if (!to || to.startsWith('uds:') || to.includes('/') || to.includes('\\')) throw new ProtocolError('invalid_target');
      const ref = /^(.*?)\s+\[([0-9a-f-]{6,36})\]$/.exec(to.trim());
      const norm = (s: string) => s.normalize('NFKC').trim().toLowerCase();
      const matches = peers.filter(p => ref ? norm(p.name) === norm(ref[1]!) && p.instanceId.startsWith(ref[2]!) : p.instanceId === to || p.sessionId === to || norm(p.name) === norm(to));
      if (matches.length !== 1) throw new ProtocolError(matches.length ? 'ambiguous_target' : 'unavailable');
      return matches[0]!;
    },
    removeOwn,
  };
}
export type Registry = ReturnType<typeof createRegistry>;
