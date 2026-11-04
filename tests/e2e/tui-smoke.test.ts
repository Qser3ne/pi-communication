import { expect,it } from 'vitest';
import { mkdtemp,writeFile,rm } from 'node:fs/promises';import { tmpdir } from 'node:os';import { join,dirname,resolve } from 'node:path';import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';import { promisify } from 'node:util';
import { fakeModel,content } from '../fixtures/fake-model-server.ts';import { resolvePaths } from '../../src/registry.ts';
it('exercises two interactive Pi terminals through PTYs',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'pi-tui-'));
  const server=await fakeModel(async request=>{
    if(request.model==='B'&&!request.tools?.length){await writeFile(join(dir,'compacting'),'1');await new Promise(r=>setTimeout(r,3000));return {text:'summary'};}
    const last=request.messages.at(-1),text=content(last);
    if(last?.role==='user'&&text==='START')return {tool:'peer_send',args:{to:'beta',text:'PTY request'}};
    if(last?.role==='user'&&text==='SLOW')return {tool:'bash',args:{command:'sleep 30'}};
    if(last?.role==='user')for(const line of text.split('\n'))try{const frame=JSON.parse(line);if(frame.kind==='request')return {tool:'peer_reply',args:{messageId:frame.messageId,text:'PTY reply'}};}catch{}
    return {text:'done'};
  });
  try {
    await writeFile(join(dir,'models.json'),JSON.stringify({providers:{fake:{baseUrl:server.url+'/v1',api:'openai-completions',apiKey:'local-test-only',models:['A','B'].map(id=>({id}))}}}));
    await writeFile(join(dir,'settings.json'),JSON.stringify({quietStartup:true,retry:{enabled:false},compaction:{enabled:false,keepRecentTokens:1}}));
    const cli=join(dirname(fileURLToPath(import.meta.resolve('@earendil-works/pi-coding-agent'))),'cli.js');
    const {stdout}=await promisify(execFile)('python3',[resolve('tests/fixtures/tui-smoke.py'),dir,cli,resolve('src/index.ts'),process.execPath,resolve('.superpowers/sdd/2026-11-04-peer-communication/e2e')],{timeout:55000});
    expect(JSON.parse(stdout)).toEqual(['name','peers','source-rendering','compact-escape','reload','new','resume','fork','escape','pause-resume','exit-cleanup']);
  }finally{await server.close();await rm(resolvePaths(dir).socketDir,{recursive:true,force:true});await rm(dir,{recursive:true,force:true});}
},60000);
