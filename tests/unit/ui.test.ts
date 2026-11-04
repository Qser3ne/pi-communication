import { expect, it } from 'vitest';
import type { ExtensionAPI, ExtensionCommandContext } from '@earendil-works/pi-coding-agent';
import { registerPeerUi, renderPeerText, peerLabel } from '../../src/ui.ts';import { message } from '../helpers/fixtures.ts';import type { PeerRuntime } from '../../src/runtime.ts';import type { PeerView } from '../../src/protocol.ts';import { visibleWidth } from '@earendil-works/pi-tui';
it('shows provenance and strips terminal controls without losing line breaks',()=>{
  const esc=String.fromCharCode(27),bel=String.fromCharCode(7);
  const m=message({text:'hello'+esc+']0;attack'+bel+'\\nworld',from:{...message().from,name:esc+'[31mAlice'}});
  const result=renderPeerText(m,true);expect(result).toContain('Peer · Alice');expect(result).toContain('request');expect(result).toContain('world');expect(result).not.toContain(esc);
  expect(renderPeerText(message({text:'x'.repeat(2000)}),false).length).toBeLessThan(1500);
});
it('headless commands append user-visible entries without opening dialogs or triggering a model',async()=>{
  let command:any;const entries:any[]=[];
  const pi={registerCommand:(_name:string,definition:any)=>command=definition,registerMessageRenderer:()=>{},registerEntryRenderer:()=>{},appendEntry:(...args:any[])=>entries.push(args)} as unknown as ExtensionAPI;
  registerPeerUi(pi,()=>undefined);
  await command.handler('',{hasUI:false} as ExtensionCommandContext);
  expect(entries[0][0]).toBe('peer-notice');expect(entries[0][1].text).toContain('unavailable');
});
it('uses real TUI Text components and supports list/pause/resume without dialogs',async()=>{
  const self:PeerView={...message().from,version:1,pid:1,cwd:'/project',endpoint:'',features:[],activity:'idle',paused:false};
  const peers=[{...self,instanceId:'11111111-1111-1111-1111-111111111111'},{...self,instanceId:'11111111-1111-1111-1111-111111111112'}];
  expect(peerLabel(peers[0]!,peers)).not.toBe(peerLabel(peers[1]!,peers));
  let command:any;const renderers=new Map<string,any>(),notices:string[]=[];
  const runtime={info:()=>self,list:async()=>peers,pause:()=>self.paused=true,resume:()=>self.paused=false} as unknown as PeerRuntime;
  const pi={registerCommand:(_n:string,c:any)=>command=c,registerMessageRenderer:(n:string,r:any)=>renderers.set(n,r),registerEntryRenderer:()=>{},appendEntry:()=>{}} as unknown as ExtensionAPI;
  registerPeerUi(pi,()=>runtime);
  const ctx={hasUI:true,ui:{notify:(text:string)=>notices.push(text)}} as unknown as ExtensionCommandContext;
  await command.handler('pause',ctx);expect(self.paused).toBe(true);
  await command.handler('resume',ctx);expect(self.paused).toBe(false);
  await command.handler('',ctx);expect(notices.at(-1)).toContain('/project');
  const component=renderers.get('peer-message')({details:{message:message({text:'宽字符 '.repeat(30)})}},{expanded:true,outputPad:0});
  expect(component.render(24).every((line:string)=>visibleWidth(line)<=24)).toBe(true);
});
