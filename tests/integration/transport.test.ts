import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createConnection, createServer, type Server } from 'node:net';
import { mkdtemp, chmod, rm, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { listenPeer, sendFrame, probePeer, type PeerServer } from '../../src/transport.ts';
import type { Envelope, PeerRecord } from '../../src/protocol.ts';
import { identity, message } from '../helpers/fixtures.ts';
let root:string, server:PeerServer|undefined, raw:Server|undefined;
beforeEach(async()=>{root=await mkdtemp(join(tmpdir(),'piipc-'));});
afterEach(async()=>{await server?.close(); if(raw?.listening) await new Promise<void>(r=>raw!.close(()=>r())); await rm(root,{recursive:true,force:true});server=undefined;raw=undefined;});
const token=randomBytes(32).toString('hex');
function record():PeerRecord{return {...identity('B'),version:1,pid:process.pid,cwd:root,endpoint:join(root,'b.sock'),features:[]};}
describe('real Unix IPC',()=>{
  it('delivers to an independent Node process',async()=>{
    const r=record();
    const child=fork(fileURLToPath(new URL('../fixtures/peer-process.ts',import.meta.url)),[],{execArgv:['--import','tsx'],env:{...process.env,TEST_PEER_RECORD:JSON.stringify(r),TEST_PEER_TOKEN:token},stdio:['ignore','ignore','pipe','ipc']});
    try {
      await new Promise<void>((resolve,reject)=>{child.on('message',(m:any)=>{if(m.type==='ready')resolve();});child.once('error',reject);child.once('exit',code=>reject(Error('child exited '+code)));});
      const received=new Promise<any>(resolve=>child.on('message',(m:any)=>{if(m.type==='received')resolve(m.frame);}));
      const m=message({to:{sessionId:r.sessionId,instanceId:r.instanceId,name:r.name}});
      expect((await sendFrame(r,token,m)).status).toBe('accepted');
      expect((await received).messageId).toBe(m.messageId);
    } finally { child.send('stop'); await new Promise<void>(resolve=>child.once('exit',()=>resolve())); }
  });
  it('bounds concurrent sockets and rejects oversized unfinished or malformed frames',async()=>{
    const r=record();let count=0;
    server=await listenPeer({record:r,token,getView:()=>({...r,activity:'idle',paused:false}),onFrame:async f=>{count++;return {messageId:f.messageId,status:'accepted'};}});
    const sockets=await Promise.all(Array.from({length:32},()=>new Promise<ReturnType<typeof createConnection>>(resolve=>{const s=createConnection(r.endpoint);s.on('error',()=>{});s.once('connect',()=>resolve(s));})));
    await new Promise<void>(resolve=>{const extra=createConnection(r.endpoint);extra.on('error',()=>{});extra.once('close',()=>resolve());});
    for(const s of sockets)s.destroy();
    await new Promise<void>(resolve=>setImmediate(resolve));
    for(const payload of [Buffer.alloc(1024*1024,120),Buffer.from('{not json}'+String.fromCharCode(10)),Buffer.from('{"half":')]){
      await new Promise<void>(resolve=>{const s=createConnection(r.endpoint);s.on('error',()=>{});s.once('close',()=>resolve());s.once('connect',()=>s.end(payload));});
    }
    expect(count).toBe(0);
  });
  it('authenticates, probes without delivering, and waits for the correlated ACK',async()=>{
    const r=record(), seen:Envelope[]=[];
    server=await listenPeer({record:r,token,getView:()=>({...r,activity:'idle',paused:false}),onFrame:async f=>{seen.push(f); return {messageId:f.messageId,status:'accepted'};}});
    expect((await probePeer(r,token)).instanceId).toBe(r.instanceId); expect(seen).toEqual([]);
    const m=message({to:r}); // identity must not contain record-only fields
    m.to={sessionId:r.sessionId,instanceId:r.instanceId,name:r.name};
    expect((await sendFrame(r,token,m)).status).toBe('accepted'); expect(seen).toHaveLength(1);
    expect((await sendFrame(r,'0'.repeat(64),message({to:m.to}))).status).toBe('unavailable');
    expect(seen).toHaveLength(1); await server.close(); await server.close();
  });
  it('rejects old target instances before delivery',async()=>{
    const r=record();let count=0;
    server=await listenPeer({record:r,token,getView:()=>({...r,activity:'idle',paused:false}),onFrame:async f=>{count++;return {messageId:f.messageId,status:'accepted'};}});
    const stale={...r,instanceId:identity().instanceId};
    expect((await sendFrame(stale,token,message())).status).toBe('unavailable');expect(count).toBe(0);
  });
  it('reports ACK loss as unknown without retrying accepted work',async()=>{
    const r=record();let count=0;
    raw=createServer(s=>{let buffer='';s.on('data',chunk=>{buffer+=chunk.toString();let i:number;while((i=buffer.indexOf('\n'))>=0){const f=JSON.parse(buffer.slice(0,i));buffer=buffer.slice(i+1);if(f.kind==='hello') s.write(JSON.stringify({kind:'ready',version:1,view:{...r,activity:'idle',paused:false}})+'\n');else {count++;s.destroy();}}});});
    await new Promise<void>(done=>raw!.listen(r.endpoint,done));await chmod(r.endpoint,0o600);
    const m=message({to:{sessionId:r.sessionId,instanceId:r.instanceId,name:r.name}});
    expect((await sendFrame(r,token,m)).status).toBe('unknown');expect(count).toBe(1);
  });
  it('closing after admission but before ACK yields unknown once and rejects new connections',async()=>{
    const r=record();let count=0,release!:()=>void,admitted!:()=>void;
    const held=new Promise<void>(resolve=>release=resolve),received=new Promise<void>(resolve=>admitted=resolve);
    server=await listenPeer({record:r,token,getView:()=>({...r,activity:'idle',paused:false}),onFrame:async f=>{count++;admitted();await held;return {messageId:f.messageId,status:'accepted'};}});
    const frame=message({to:{sessionId:r.sessionId,instanceId:r.instanceId,name:r.name}});
    const sending=sendFrame(r,token,frame);await received;
    await server.close();expect((await sending).status).toBe('unknown');release();
    expect((await sendFrame(r,token,message({to:frame.to}))).status).toBe('unavailable');
    expect(count).toBe(1);
  });
  it('parses fragmented UTF8 exactly once and rejects missing auth',async()=>{
    const r=record(),seen:Envelope[]=[];
    server=await listenPeer({record:r,token,getView:()=>({...r,activity:'idle',paused:false}),onFrame:async f=>{seen.push(f);return {messageId:f.messageId,status:'accepted'};}});
    const m=message({to:{sessionId:r.sessionId,instanceId:r.instanceId,name:r.name},text:'你好'});
    await new Promise<void>((resolve,reject)=>{const s=createConnection(r.endpoint);s.on('error',reject);s.on('close',()=>resolve());let phase=0;s.on('connect',()=>s.write(JSON.stringify({version:1,kind:'hello',token,to:m.to,from:m.from,operation:'send'})+'\n'));s.on('data',()=>{if(phase++===0){const b=Buffer.from(JSON.stringify(m)+'\n');const at=b.indexOf(Buffer.from('你'))+1;s.write(b.subarray(0,at));setImmediate(()=>s.write(b.subarray(at)));}else s.end();});});
    expect(seen).toHaveLength(1);expect(seen[0]).toMatchObject({text:'你好'});
    await new Promise<void>(resolve=>{const s=createConnection(r.endpoint);s.on('error',()=>{});s.on('close',()=>resolve());s.on('connect',()=>s.end(JSON.stringify(m)+'\n'));});
    expect(seen).toHaveLength(1);
  });
  it('does not unlink existing files and rejects cancelled sends',async()=>{
    const r=record();await writeFile(r.endpoint,'owned by someone else',{mode:0o600});
    await expect(listenPeer({record:r,token,getView:()=>({...r,activity:'idle',paused:false}),onFrame:async f=>({messageId:f.messageId,status:'accepted'})})).rejects.toThrow();
    expect(await readFile(r.endpoint,'utf8')).toBe('owned by someone else');
    const ac=new AbortController();ac.abort();
    expect((await sendFrame(r,token,message(),ac.signal)).status).toBe('unavailable');
  });
});
