import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { access,unlink } from 'node:fs/promises';import { join } from 'node:path';
export default function(pi:ExtensionAPI){
  pi.on('agent_settled',async(_event,ctx)=>{
    const flag=join(ctx.cwd,'hold-settled'),release=join(ctx.cwd,'release-settled');
    try{await access(flag);}catch{return;}
    await unlink(flag);ctx.ui.notify('settled-held','info');
    for(let i=0;i<500;i++){try{await access(release);return;}catch{}await new Promise(r=>setTimeout(r,20));}
    throw new Error('test settled gate timed out');
  });
}
