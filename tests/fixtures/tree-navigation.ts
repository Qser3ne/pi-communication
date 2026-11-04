import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
export default function(pi:ExtensionAPI){
  pi.registerCommand('test-tree',{description:'test-only controlled tree navigation',async handler(_args,ctx){
    const target=ctx.sessionManager.getBranch().find(e=>e.type==='message'&&e.message.role==='user');
    if(!target)throw new Error('seed required');await ctx.navigateTree(target.id,{summarize:true});
  }});
}
