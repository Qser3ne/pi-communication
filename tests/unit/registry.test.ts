import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, stat, chmod, readFile, writeFile, symlink, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, type Server } from 'node:net';
import { createRegistry, resolvePaths } from '../../src/registry.ts';
import type { PeerRecord, PeerView } from '../../src/protocol.ts';
import { identity } from '../helpers/fixtures.ts';

let root: string, server: Server;
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'pireg-')); });
afterEach(async () => { if(server?.listening) await new Promise<void>(r=>server.close(()=>r())); await rm(root,{recursive:true,force:true}); });
const view = (r: PeerRecord): PeerView => ({...r,activity:'idle',paused:false});
async function setup() {
  const paths=resolvePaths(root,join(root,'registry')); const registry=createRegistry(paths);
  await mkdir(paths.socketDir,{recursive:true,mode:0o700});
  const endpoint=join(paths.socketDir,'test.sock'); server=createServer(s=>s.end());
  await new Promise<void>(r=>server.listen(endpoint,r)); await chmod(endpoint,0o600);
  const record:PeerRecord={...identity('reviewer'),version:1,pid:process.pid,cwd:root,endpoint,features:[]};
  return {paths,registry,record};
}
describe('private peer registry',()=>{
  it('publishes private complete records, discovers live peers and keeps keys separate',async()=>{
    const {paths,registry,record}=await setup(); await registry.publish(record,'a'.repeat(64));
    const file=join(paths.sessionsDir,record.instanceId+'.json');
    expect((await stat(file)).mode&0o777).toBe(0o600);
    expect((await stat(paths.root)).mode&0o777).toBe(0o700);
    expect(await readFile(file,'utf8')).not.toContain('a'.repeat(64));
    expect(await registry.readToken(record.instanceId)).toBe('a'.repeat(64));
    expect(await registry.discover(async r=>view(r))).toHaveLength(1);
    await Promise.all([registry.updateName(record.instanceId,'builder'),registry.updateName(record.instanceId,'final')]);
    expect(JSON.parse(await readFile(file,'utf8'))).toMatchObject({name:'final',endpoint:record.endpoint});
    await registry.removeOwn(record.instanceId); await registry.removeOwn(record.instanceId);
    expect(await registry.discover(async r=>view(r))).toEqual([]);
    await rm(paths.socketDir,{recursive:true,force:true});
  });
  it('rejects ambiguous names and session IDs, supports explicit instance references',async()=>{
    const {registry,record,paths}=await setup();
    const other={...record,instanceId:identity().instanceId};
    expect(()=>registry.resolve('reviewer',[view(record),view(other)])).toThrow('ambiguous_target');
    expect(()=>registry.resolve(record.sessionId,[view(record),view(other)])).toThrow('ambiguous_target');
    expect(registry.resolve('reviewer ['+other.instanceId.slice(0,8)+']',[view(record),view(other)]).instanceId).toBe(other.instanceId);
    expect(()=>registry.resolve('uds:/tmp/x.sock',[view(record)])).toThrow();
    await rm(paths.socketDir,{recursive:true,force:true});
  });
  it('refuses symlinks and writable directories without changing their permissions',async()=>{
    const unsafe=join(root,'unsafe'); await mkdir(unsafe); await chmod(unsafe,0o777);
    const r=createRegistry(resolvePaths(root,unsafe));
    const p={...identity(),version:1 as const,pid:process.pid,cwd:root,endpoint:'/tmp/no.sock',features:[]};
    await expect(r.publish(p,'a'.repeat(64))).rejects.toThrow('unsafe_path');
    expect((await stat(unsafe)).mode&0o777).toBe(0o777);
    await symlink(unsafe,join(root,'link'));
    await expect(createRegistry(resolvePaths(root,join(root,'link'))).publish(p,'a'.repeat(64))).rejects.toThrow('unsafe_path');
  });
  it('does not discover malformed, dead, mismatched or probe-failed peers',async()=>{
    const {registry,record,paths}=await setup(); await registry.publish(record,'a'.repeat(64));
    await writeFile(join(paths.sessionsDir,identity().instanceId+'.json'),'{oops',{mode:0o600});
    expect(await registry.discover(async()=>{throw Error('unreachable')})).toEqual([]);
    expect(await registry.discover(async r=>({...view(r),instanceId:identity().instanceId}))).toEqual([]);
    await writeFile(join(paths.sessionsDir,record.instanceId+'.json'),JSON.stringify({...record,pid:2147483647}),{mode:0o600});
    expect(await registry.discover(async r=>view(r))).toEqual([]);
    await rm(paths.socketDir,{recursive:true,force:true});
  });
  it('never replaces or removes pre-existing files on failed publication',async()=>{
    const {registry,record,paths}=await setup();
    await mkdir(paths.keysDir,{recursive:true,mode:0o700});
    const path=join(paths.keysDir,record.instanceId+'.json'); await writeFile(path,'existing',{mode:0o600});
    await expect(registry.publish(record,'b'.repeat(64))).rejects.toThrow();
    await registry.removeOwn(record.instanceId);
    expect(await readFile(path,'utf8')).toBe('existing');
    await rm(paths.socketDir,{recursive:true,force:true});
  });
});
