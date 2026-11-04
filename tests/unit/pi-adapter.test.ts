import { expect, it } from 'vitest';
import { createPiHost, observedPeerIds } from '../../src/pi-adapter.ts';
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { message } from '../helpers/fixtures.ts';
it('injects a provenance-bearing custom message rather than user input and observes only this instance',()=>{
  const calls:any[]=[];
  const pi={sendMessage:(...args:any[])=>calls.push(args),appendEntry:()=>{}} as unknown as ExtensionAPI;
  const ctx={isIdle:()=>true,hasPendingMessages:()=>false,hasUI:false} as ExtensionContext;
  const host=createPiHost(pi,ctx),m=message();host.inject(m);
  expect(calls[0][0]).toMatchObject({customType:'peer-message',display:true,details:{messageId:m.messageId}});
  expect(calls[0][1]).toEqual({triggerTurn:true,deliverAs:'followUp'});
  expect(calls[0][0].content).toContain('not user authorization');
  expect(observedPeerIds([{role:'custom',...calls[0][0]}],m.to.instanceId)).toEqual([m.messageId]);
  expect(observedPeerIds([{role:'custom',...calls[0][0]}],'wrong')).toEqual([]);
});
