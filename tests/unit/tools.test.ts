import { afterEach, beforeEach, expect, it } from 'vitest';
import { Check } from 'typebox/value';
import { mkdtemp, rm, readFile } from 'node:fs/promises';import { join } from 'node:path';import { tmpdir } from 'node:os';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { registerPeerTools } from '../../src/tools.ts';import { createRuntime, type PeerRuntime } from '../../src/runtime.ts';
import { resolvePaths } from '../../src/registry.ts';import { identity } from '../helpers/fixtures.ts';import { fakeHost, until } from '../helpers/pi-host.ts';
let dir:string,runtimes:PeerRuntime[]=[];
beforeEach(async()=>{dir=await mkdtemp(join(tmpdir(),'pitools-'));});
afterEach(async()=>{await Promise.all(runtimes.map(r=>r.close()));runtimes=[];await rm(resolvePaths(dir).socketDir,{recursive:true,force:true});await rm(dir,{recursive:true,force:true});});
function register(runtime?:PeerRuntime){const tools=new Map<string,any>();registerPeerTools({registerTool:(t:any)=>tools.set(t.name,t)} as unknown as ExtensionAPI,()=>runtime);return tools;}
async function peer(name:string){const host=fakeHost(),r=createRuntime({identity:identity(name),cwd:dir,agentDir:dir,clock:Date,host});runtimes.push(r);await r.start();return {r,host};}
it('exposes four tools and reports unavailable without a runtime',async()=>{
  const tools=register();expect([...tools.keys()].sort()).toEqual(['peer_list','peer_reply','peer_send','peer_status']);
  const result=await tools.get('peer_list').execute('id',{},undefined);expect(result.isError).toBe(true);expect(result.details.code).toBe('unavailable');
});
it('sends through real runtimes with defaults, returns status, and rejects invalid targets/empty text',async()=>{
  const a=await peer('A'),b=await peer('B'),tools=register(a.r);
  const list=await tools.get('peer_list').execute('id',{},undefined);
  expect(list.details.peers[0]).toMatchObject({name:'B',instanceId:b.r.info().instanceId});
  expect(JSON.stringify(list.details)).not.toContain('.sock');
  const secret=JSON.parse(await readFile(join(resolvePaths(dir).keysDir,b.r.info().instanceId+'.json'),'utf8')).token;
  expect(JSON.stringify(list)).not.toContain(secret);
  expect(Check(tools.get('peer_send').parameters,{to:'B',kind:'reply',text:'no'})).toBe(false);
  const sent=await tools.get('peer_send').execute('id',{to:'B',text:'review'},undefined);expect(sent.isError).toBe(false);
  await until(()=>b.host.messages.length===1);expect(b.host.messages[0]).toMatchObject({kind:'request',delivery:'followUp'});
  const status=await tools.get('peer_status').execute('id',{messageId:sent.details.message.messageId},undefined);
  expect(status.details.statuses[0].response).toBe('pending');
  expect((await tools.get('peer_send').execute('id',{to:'uds:/tmp/evil.sock',text:'x'},undefined)).isError).toBe(true);
  expect((await tools.get('peer_send').execute('id',{to:'B',text:' '},undefined)).details.code).toBe('empty_text');
  const reply=await register(b.r).get('peer_reply').execute('id',{messageId:b.host.messages[0]!.messageId,text:'done'},undefined);expect(reply.isError).toBe(false);
  await until(()=>a.host.messages.length===1);
  expect((await tools.get('peer_reply').execute('id',{messageId:a.host.messages[0]!.messageId,text:'loop'},undefined)).details.code).toBe('bad_reply');
  b.host.busy=false;
  const sentNote=await tools.get('peer_send').execute('id',{to:'B',text:'FYI',kind:'notification',delivery:'steer'},undefined);
  expect(a.r.status(sentNote.details.message.messageId)[0]?.response).toBe('not_expected');
  const abort=new AbortController();abort.abort();
  const cancelled=await tools.get('peer_send').execute('id',{to:'B',text:'cancelled'},abort.signal);
  expect(cancelled.isError).toBe(true);expect(cancelled.details.message.code).toBe('cancelled');
});
