import { expect,it } from 'vitest';import { execFile } from 'node:child_process';import { promisify } from 'node:util';import { mkdtemp,writeFile,rm,mkdir } from 'node:fs/promises';import { tmpdir } from 'node:os';import { join } from 'node:path';
import { fakeModel } from '../fixtures/fake-model-server.ts';import { rpcPeer,type RpcPeer } from '../helpers/rpc-peer.ts';import { resolvePaths } from '../../src/registry.ts';
it('packs only public source and loads its manifest entry in an isolated Pi process',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'pi-pack-')),agent=join(dir,'agent');await mkdir(agent);
  const server=await fakeModel(()=>({text:'done'}));let peer:RpcPeer|undefined;
  try {
    const exec=promisify(execFile);await exec('pnpm',['pack','--pack-destination',dir]);
    const archive=join(dir,'pi-communication-0.1.0.tgz');
    const {stdout}=await exec('tar',['-tzf',archive]);const files=stdout.trim().split('\n');
    expect(files.every(p=>/^package\/(README\.md|package\.json|src\/[a-z-]+\.ts)$/.test(p))).toBe(true);
    expect(files).toContain('package/src/index.ts');
    await exec('tar',['-xzf',archive,'-C',dir]);
    await writeFile(join(agent,'models.json'),JSON.stringify({providers:{fake:{baseUrl:server.url+'/v1',api:'openai-completions',apiKey:'local-test-only',models:[{id:'A'}]}}}));
    peer=rpcPeer(agent,dir,'A',[],join(dir,'package'));
    const commands=await peer.command('get_commands');expect(commands.commands.some((c:any)=>c.name==='peers')).toBe(true);
    const result=await peer.command('prompt',{message:'/peers'});expect(result.disposition).toBe('handled');
    expect(peer.events.some(e=>e.type==='extension_ui_request'&&e.message?.includes('Self:'))).toBe(true);
  }finally{await peer?.close();await server.close();await rm(resolvePaths(agent).socketDir,{recursive:true,force:true});await rm(dir,{recursive:true,force:true});}
},60000);
