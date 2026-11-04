import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRuntime, type PeerRuntime } from '../../src/runtime.ts';
import { resolvePaths } from '../../src/registry.ts';
import { identity } from '../helpers/fixtures.ts';
import { fakeHost, until } from '../helpers/pi-host.ts';
let dir:string;let runtimes:PeerRuntime[]=[];
beforeEach(async()=>{dir=await mkdtemp(join(tmpdir(),'piruntime-'));});
afterEach(async()=>{await Promise.all(runtimes.map(r=>r.close()));runtimes=[];await rm(resolvePaths(dir).socketDir,{recursive:true,force:true});await rm(dir,{recursive:true,force:true});});
async function peer(name:string,sessionId?:string){const host=fakeHost(),id=identity(name);if(sessionId)id.sessionId=sessionId;const runtime=createRuntime({identity:id,agentDir:dir,cwd:dir,clock:Date,host});runtimes.push(runtime);await runtime.start();return {runtime,host,id};}
describe('peer runtime scheduling and lifecycle',()=>{
  it('cancels startup without publishing a ghost endpoint',async()=>{
    const host=fakeHost(),id=identity('closing');
    const runtime=createRuntime({identity:id,agentDir:dir,cwd:dir,clock:Date,host});runtimes.push(runtime);
    const start=runtime.start();const stop=runtime.close();
    await expect(start).rejects.toThrow();await stop;
    const other=await peer('observer');expect(await other.runtime.list()).toEqual([]);
  });
  it('discovers, sends, explicitly replies and wakes both hosts exactly once',async()=>{
    const a=await peer('A'),b=await peer('B');
    expect((await a.runtime.list()).map(p=>p.name)).toEqual(['B']);
    const sent=await a.runtime.send({to:'B',text:'review'});
    expect(sent.message?.status).toBe('accepted');await until(()=>b.host.messages.length===1);
    const req=b.host.messages[0]!;expect(req.from.instanceId).toBe(a.id.instanceId);
    const response=await b.runtime.reply({messageId:req.messageId,text:'done'});
    expect(response.status).toBe('accepted');await until(()=>a.host.messages.length===1);
    expect(a.host.messages[0]).toMatchObject({kind:'reply',replyTo:req.messageId});
    expect(a.runtime.status(req.messageId)[0]?.response).toBe('replied');
    await expect(b.runtime.reply({messageId:req.messageId,text:'again'})).rejects.toThrow('bad_reply');
  });
  it('holds followUp while busy, steers without aborting, and pauses on Esc',async()=>{
    const a=await peer('A'),b=await peer('B');b.host.busy=true;
    await a.runtime.send({to:'B',text:'later'});expect(b.host.messages).toEqual([]);
    await a.runtime.send({to:'B',text:'urgent',delivery:'steer'});await until(()=>b.host.messages.length===1);
    expect(b.host.messages[0]?.text).toBe('urgent');b.runtime.observeContext([b.host.messages[0]!.messageId]);
    b.host.busy=false;b.runtime.onSettled(true);expect(b.host.messages).toHaveLength(1);
    expect((await a.runtime.send({to:'B',text:'paused'})).message).toMatchObject({status:'rejected',code:'paused'});
    b.runtime.resume();await until(()=>b.host.messages.length===2);expect(b.host.messages[1]?.text).toBe('later');
  });
  it('rejects stale identities and same-session ambiguity, cleans repeated shutdown',async()=>{
    const a=await peer('A'),b=await peer('same'),c=await peer('same',b.id.sessionId);
    await expect(a.runtime.send({to:b.id.sessionId,text:'ambiguous'})).rejects.toThrow('ambiguous_target');
    await b.runtime.close();await b.runtime.close();
    await expect(a.runtime.send({to:b.id.instanceId,text:'stale'})).rejects.toThrow('unavailable');
    await a.runtime.send({to:c.id.instanceId,text:'valid'});await until(()=>c.host.messages.length===1);
    expect(b.host.messages).toEqual([]);
  });
  it('does not inject after close, and reports injection failure without retry',async()=>{
    const a=await peer('A'),b=await peer('B');b.host.busy=true;
    await a.runtime.send({to:'B',text:'pending'});await b.runtime.close();b.host.busy=false;b.runtime.onSettled(false);b.runtime.resume();
    expect(b.host.messages).toEqual([]);
    const c=await peer('C');c.host.fail=true;const sent=await a.runtime.send({to:'C',text:'fail'});
    await until(()=>a.runtime.status(sent.message!.messageId)[0]?.delivery==='dropped');
    expect(c.host.messages).toEqual([]);
  });
});
