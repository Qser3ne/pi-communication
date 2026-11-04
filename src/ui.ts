import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { Text } from '@earendil-works/pi-tui';
import { cleanDisplay, cleanName, parseEnvelope, type MessageEnvelope, type PeerView } from './protocol.ts';
import type { PeerRuntime } from './runtime.ts';

export function peerLabel(peer: PeerView, peers: PeerView[]): string {
  let length=8;
  while(length<36 && peers.some(other=>other.instanceId!==peer.instanceId && other.instanceId.startsWith(peer.instanceId.slice(0,length)))) length++;
  return cleanName(peer.name)+' ['+peer.instanceId.slice(0,length)+']';
}
export function renderPeerText(message: MessageEnvelope, expanded: boolean): string {
  const text=cleanDisplay(message.text), max=expanded?50000:1000;
  return 'Peer · '+cleanName(message.from.name)+' · '+message.kind+' · '+message.messageId.slice(0,8)+'\n'+text.slice(0,max)+(text.length>max?'\n… (display truncated; full content remains in session history)':'');
}
export function registerPeerUi(pi: ExtensionAPI, getRuntime: () => PeerRuntime | undefined): void {
  pi.registerMessageRenderer('peer-message',(message,options)=>{
    try {
      const details=message.details as {message?:unknown}|undefined;
      const frame=parseEnvelope(details?.message);
      if ('text' in frame) return new Text(renderPeerText(frame,options.expanded),options.outputPad,0);
    } catch { /* Old or damaged session metadata is not trusted. */ }
    return new Text('Peer · '+cleanDisplay(typeof message.content==='string'?message.content:'[unavailable]'),options.outputPad,0);
  });
  pi.registerMessageRenderer('peer-notice',(message,options)=>new Text(cleanDisplay(typeof message.content==='string'?message.content:'Peer status'),options.outputPad,0));
  pi.registerEntryRenderer('peer-notice',(entry,options)=>{
    const data=entry.data as {text?:unknown}|undefined;
    return new Text(cleanDisplay(typeof data?.text==='string'?data.text:'Peer status'),0,0);
  });
  pi.registerCommand('peers',{
    description:'List local Pi peers, or pause/resume peer intake',
    getArgumentCompletions(prefix){return ['pause','resume'].filter(value=>value.startsWith(prefix)).map(value=>({value,label:value}));},
    async handler(args,ctx){
      const r=getRuntime();let text:string;
      if(!r)text='Peer communication unavailable.';
      else if(args.trim()==='pause'){r.pause();text='Peer intake paused. Already-submitted messages cannot be recalled.';}
      else if(args.trim()==='resume'){r.resume();text='Peer intake resumed.';}
      else if(args.trim())text='Usage: /peers [pause|resume]';
      else {
        const peers=await r.list();if(getRuntime()!==r)return;
        const own=r.info();
        text='Self: '+cleanName(own.name)+' ['+own.instanceId+'] · '+(own.paused?'paused':own.activity)+'\n'+(peers.slice(0,100).map(p=>peerLabel(p,peers)+' · '+(p.paused?'paused':p.activity)+' · '+cleanDisplay(p.cwd).slice(0,256)).join('\n')||'No other online peers.')+(peers.length>100?'\nUse peer_list pagination for remaining peers.':'');
      }
      pi.appendEntry('peer-notice',{text});
      if(ctx.hasUI)ctx.ui.notify(text,'info');
    },
  });
}
