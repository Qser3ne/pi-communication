import type { MessageEnvelope } from '../../src/protocol.ts';
export function fakeHost() {
  return { busy: false, pending: false, fail: false, messages: [] as MessageEnvelope[], notices: [] as {text:string;modelVisible:boolean}[],
    isIdle() { return !this.busy; }, hasPendingMessages() { return this.pending; },
    inject(message:MessageEnvelope) { if(this.fail)throw Error('injection failed');this.messages.push(message);this.busy=true; },
    notice(text:string,modelVisible:boolean) {this.notices.push({text,modelVisible});}
  };
}
export async function until(predicate:()=>boolean, ms=3000) {
  const end=Date.now()+ms;while(!predicate()){if(Date.now()>end)throw Error('condition timeout');await new Promise(r=>setTimeout(r,10));}
}
