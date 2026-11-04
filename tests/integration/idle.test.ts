import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';import { join } from 'node:path';
import { createRuntime, type PeerRuntime } from '../../src/runtime.ts';
import { resolvePaths } from '../../src/registry.ts';
import { identity } from '../helpers/fixtures.ts';import { fakeHost, until } from '../helpers/pi-host.ts';
let dir:string,runtimes:PeerRuntime[]=[];
beforeEach(async()=>{dir=await mkdtemp(join(tmpdir(),'piidle-'));});
afterEach(async()=>{await Promise.all(runtimes.map(r=>r.close()));runtimes=[];await rm(resolvePaths(dir).socketDir,{recursive:true,force:true});await rm(dir,{recursive:true,force:true});});
async function peer(name:string){const host=fakeHost(),r=createRuntime({identity:identity(name),cwd:dir,agentDir:dir,clock:Date,host});runtimes.push(r);await r.start();return {r,host};}
it('subscribes without a business message, notifies once, and logs only when requester is paused',async()=>{
  const a=await peer('A'),b=await peer('B');a.r.pause();
  const result=await a.r.send({to:'B',notifyWhenIdle:true});expect(result.subscription?.status).toBe('accepted');expect(result.message).toBeUndefined();
  expect(b.host.messages).toEqual([]);await until(()=>a.host.notices.length===1);
  expect(a.host.notices[0]).toMatchObject({modelVisible:false});expect(a.host.notices[0]?.text).toContain('idle');
  b.r.onSettled(false);await new Promise(r=>setTimeout(r,900));expect(a.host.notices).toHaveLength(1);
});
it('rechecks eligibility after debounce and reports normal exit instead of claiming idle',async()=>{
  const a=await peer('A'),b=await peer('B');
  await a.r.send({to:'B',notifyWhenIdle:true});
  b.host.busy=true;await new Promise(r=>setTimeout(r,900));expect(a.host.notices).toEqual([]);
  await b.r.close();await until(()=>a.host.notices.length===1);expect(a.host.notices[0]?.text).toContain('exited');
});
