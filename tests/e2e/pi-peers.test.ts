import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdtemp,mkdir,writeFile,readFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';import { join } from 'node:path';
import { fakeModel, content, type Completion, type ChatRequest } from '../fixtures/fake-model-server.ts';
import { rpcPeer,type RpcPeer } from '../helpers/rpc-peer.ts';import { resolvePaths } from '../../src/registry.ts';
let dir:string,peers:RpcPeer[]=[],server:Awaited<ReturnType<typeof fakeModel>>|undefined;
beforeEach(async()=>{dir=await mkdtemp(join(tmpdir(),'pi-e2e-'));});
afterEach(async()=>{
  await Promise.all(peers.map(p=>p.close()));
  const logs='.superpowers/sdd/2026-11-04-peer-communication/e2e';await mkdir(logs,{recursive:true});
  for(const [i,p] of peers.entries())await writeFile(join(logs,'peer-'+i+'.json'),JSON.stringify({events:p.events,stderr:p.stderr},null,2).replace(/[0-9a-f]{64}/g,'[redacted]'));
  peers=[];await server?.close();server=undefined;
  await rm(resolvePaths(dir).socketDir,{recursive:true,force:true});await rm(dir,{recursive:true,force:true});
},20000);
async function setup(respond:(r:ChatRequest)=>Completion|Promise<Completion>){
  server=await fakeModel(respond);
  await writeFile(join(dir,'models.json'),JSON.stringify({providers:{fake:{baseUrl:server.url+'/v1',api:'openai-completions',apiKey:'local-test-only',models:['A','B'].map(id=>({id,contextWindow:128000,maxTokens:1024}))}}}));
  await writeFile(join(dir,'settings.json'),JSON.stringify({retry:{enabled:false},compaction:{enabled:false},quietStartup:true}));
  const create=async(name:string,extra:string[]=[])=>{const cwd=join(dir,name+'-'+peers.length);await mkdir(cwd);const peer=rpcPeer(dir,cwd,name,extra);peers.push(peer);await peer.command('get_state');return peer;};
  return create;
}
function peerData(text:string):any|undefined { for(const line of text.split('\n'))try{const data=JSON.parse(line);if(data.messageId&&data.kind)return data;}catch{} }
const delivered=(p:RpcPeer,kind:string)=>p.events.filter(e=>e.type==='message_end'&&e.message?.customType==='peer-message'&&e.message?.details?.message?.kind===kind);
it('two real Pi processes discover, send and explicitly reply without another user prompt',async()=>{
  let sideEffects=0;
  const create=await setup(request=>{
    const last=request.messages.at(-1),text=content(last),data=peerData(text);
    if(request.model==='A'&&text==='START')return {tool:'peer_list',args:{}};
    if(request.model==='A'&&last?.role==='tool'){
      const result=JSON.parse(text);
      if(result.peers)return {tool:'peer_send',args:{to:result.peers.find((p:any)=>p.name==='B').instanceId,text:'Review once'}};
    }
    if(request.model==='B'&&data?.kind==='request'){sideEffects++;return {tool:'peer_reply',args:{messageId:data.messageId,text:'Reviewed'}};}
    return {text:'done'};
  });
  const a=await create('A'),b=await create('B');
  const ready=await a.command('get_commands');expect(ready.commands.some((c:any)=>c.name==='peers')).toBe(true);
  await a.prompt('START');
  const replyEvent=await a.wait(e=>e.type==='message_end'&&e.message?.details?.message?.kind==='reply');
  await b.wait(e=>e.type==='agent_settled');
  const request=delivered(b,'request')[0].message.details.message,reply=replyEvent.message.details.message;
  expect(reply.replyTo).toBe(request.messageId);expect(reply.from.instanceId).toBe(request.to.instanceId);
  expect(delivered(a,'reply')).toHaveLength(1);expect(sideEffects).toBe(1);
  expect(b.events.filter(e=>e.type==='message_end'&&e.message?.role==='user')).toHaveLength(0);
  expect(a.events.some(e=>e.type==='tool_execution_end'&&e.toolName==='peer_send'&&!e.isError)).toBe(true);
},60000);
it('supports Pi custom session IDs without using them as file paths',async()=>{
  const create=await setup(scripted),a=await create('A'),b=await create('B',['--session-id','review.session-42']);
  expect((await call(a,'peer_list')).peers[0].sessionId).toBe('review.session-42');
  expect((await call(a,'peer_send',{to:'review.session-42',text:'custom ID',kind:'notification'})).message.status).toBe('accepted');
  await b.wait(e=>e.type==='message_end'&&e.message?.details?.message?.text==='custom ID');
},60000);
function scripted(request:ChatRequest):Completion {
  const last=request.messages.at(-1),text=content(last);
  if(last?.role==='user'&&text.startsWith('CALL '))return JSON.parse(text.slice(5));
  return {text:'done'};
}
async function call(peer:RpcPeer,tool:string,args:Record<string,unknown>={}):Promise<any>{
  const cursor=peer.events.length;await peer.prompt('CALL '+JSON.stringify({tool,args}));
  return peer.events.slice(cursor).find(e=>e.type==='tool_execution_end'&&e.toolName===tool)?.result.details;
}
it('followUp waits, steer preserves the running tool, and abort pauses until explicit resume',async()=>{
  const create=await setup(scripted),a=await create('A'),b=await create('B');
  const release=join(dir,'release'),effects=join(dir,'effects');
  const slow="while [ ! -f '"+release+"' ]; do sleep 0.05; done; printf x >> '"+effects+"'";
  let cursor=b.events.length;
  await b.command('prompt',{message:'CALL '+JSON.stringify({tool:'bash',args:{command:slow}})});
  await b.wait(e=>e.type==='tool_execution_start'&&e.toolName==='bash',cursor);
  expect((await call(a,'peer_send',{to:'B',text:'later',kind:'notification'})).message.status).toBe('accepted');
  expect((await call(a,'peer_send',{to:'B',text:'urgent',kind:'notification',delivery:'steer'})).message.status).toBe('accepted');
  expect(delivered(b,'notification')).toHaveLength(0);
  expect(b.events.slice(cursor).some(e=>e.type==='tool_execution_end')).toBe(false);
  await writeFile(release,'go');
  await b.wait(e=>e.type==='message_end'&&e.message?.details?.message?.text==='later',cursor);
  await b.wait(e=>e.type==='agent_settled',b.events.findIndex(e=>e.type==='message_end'&&e.message?.details?.message?.text==='later'));
  expect(delivered(b,'notification').map(e=>e.message.details.message.text)).toEqual(['urgent','later']);
  expect(await readFile(effects,'utf8')).toBe('x');
  await rm(release);cursor=b.events.length;
  await b.command('prompt',{message:'CALL '+JSON.stringify({tool:'bash',args:{command:slow}})});
  await b.wait(e=>e.type==='tool_execution_start'&&e.toolName==='bash',cursor);
  await call(a,'peer_send',{to:'B',text:'after-abort',kind:'notification'});
  await b.command('clear_queue');await b.command('abort');
  expect(b.events.slice(cursor).some(e=>e.type==='agent_settled'&&e.aborted)).toBe(true);
  expect(delivered(b,'notification')).toHaveLength(2);
  expect((await call(a,'peer_send',{to:'B',text:'blocked'})).message).toMatchObject({status:'rejected',code:'paused'});
  await b.command('prompt',{message:'/peers resume'});
  await b.wait(e=>e.type==='message_end'&&e.message?.details?.message?.text==='after-abort',cursor);
  expect(await readFile(effects,'utf8')).toBe('x');
  await b.command('prompt',{message:'/peers pause'});
  expect((await call(a,'peer_list')).peers[0].paused).toBe(true);
},60000);
it('disambiguates names/session IDs and replaces identities on new, switch, fork and restart',async()=>{
  const create=await setup(scripted),a=await create('A'),b=await create('B');
  await b.prompt('seed');const old=await b.command('get_state');
  const c=await create('B',['--session-id',old.sessionId]);
  await b.command('set_session_name',{name:'duplicate'});await c.command('set_session_name',{name:'duplicate'});
  let listed=(await call(a,'peer_list')).peers;expect(listed).toHaveLength(2);
  expect(new Set(listed.map((p:any)=>p.sessionId)).size).toBe(1);
  expect((await call(a,'peer_send',{to:'duplicate',text:'wrong'})).code).toBe('ambiguous_target');
  expect((await call(a,'peer_send',{to:old.sessionId,text:'wrong'})).code).toBe('ambiguous_target');
  const retired=listed.find((p:any)=>p.cwd.includes('B-1')).instanceId;
  await b.command('new_session');
  expect((await call(a,'peer_send',{to:retired,text:'stale'})).code).toBe('unavailable');
  await b.command('switch_session',{sessionPath:old.sessionFile});
  const switched=(await call(a,'peer_list')).peers.find((p:any)=>p.cwd.includes('B-1'));
  expect(switched.sessionId).toBe(old.sessionId);expect(switched.instanceId).not.toBe(retired);
  const forks=await b.command('get_fork_messages');await b.command('fork',{entryId:forks.messages[0].entryId});
  const forked=(await call(a,'peer_list')).peers.find((p:any)=>p.cwd.includes('B-1'));
  expect(forked.sessionId).not.toBe(old.sessionId);expect(forked.instanceId).not.toBe(switched.instanceId);
  const cId=listed.find((p:any)=>p.cwd.includes('B-2')).instanceId;
  await c.close();
  expect((await call(a,'peer_list')).peers).toHaveLength(1);
  await create('B',['--session-id',old.sessionId]);
  listed=(await call(a,'peer_list')).peers;
  expect(listed).toHaveLength(2);expect(listed.some((p:any)=>p.instanceId===cId)).toBe(false);
},60000);
