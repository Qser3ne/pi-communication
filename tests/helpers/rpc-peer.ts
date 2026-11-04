import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
export function rpcPeer(agentDir:string,cwd:string,name:string,extra:string[]=[],extensionPath=resolve('src/index.ts')) {
  const cli=join(dirname(fileURLToPath(import.meta.resolve('@earendil-works/pi-coding-agent'))),'cli.js');
  const child=spawn(process.execPath,[cli,'--mode','rpc','--offline','--no-approve','--no-extensions','--no-skills','--no-prompt-templates','--no-themes','--no-context-files','-e',extensionPath,'--provider','fake','--model',name,'--name',name,'--tools','peer_list,peer_send,peer_reply,peer_status,bash',...extra],{cwd,env:{PATH:process.env.PATH,HOME:agentDir,PI_CODING_AGENT_DIR:agentDir,PI_OFFLINE:'1',NO_COLOR:'1'},stdio:['pipe','pipe','pipe']});
  const events:any[]=[];let buffer='',stderr='',ended=false;
  const closed=new Promise<void>(resolve=>child.once('exit',()=>{ended=true;resolve();}));
  child.on('error',error=>{stderr+=String(error);ended=true;});
  child.stderr.setEncoding('utf8').on('data',data=>stderr+=data);
  child.stdout.setEncoding('utf8').on('data',data=>{
    buffer+=data;let n:number;
    while((n=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,n);buffer=buffer.slice(n+1);if(!line.trim())continue;try{events.push(JSON.parse(line));}catch{stderr+='Invalid stdout: '+line;}}
  });
  async function wait(predicate:(event:any)=>boolean,after=0,ms=20000):Promise<any>{
    const deadline=Date.now()+ms;
    while(Date.now()<deadline){const event=events.slice(after).find(predicate);if(event)return event;if(ended)break;await new Promise(r=>setTimeout(r,20));}
    throw new Error('RPC wait failed: '+stderr+'; tail: '+JSON.stringify(events.slice(-8)));
  }
  async function command(type:string,args:Record<string,unknown>={}):Promise<any>{
    const id=randomUUID(),response=wait(e=>e.type==='response'&&e.id===id);
    child.stdin.write(JSON.stringify({id,type,...args})+'\n');
    const r=await response;if(!r.success)throw new Error(r.error);return r.data;
  }
  return {events,wait,command,pid:child.pid,get stderr(){return stderr;},
    async prompt(message:string){const cursor=events.length;await command('prompt',{message});await wait(e=>e.type==='agent_settled',cursor);},
    async close(){if(ended)return;child.stdin.end();const kill=setTimeout(()=>child.kill('SIGKILL'),6000);await closed;clearTimeout(kill);},
  };
}
export type RpcPeer=ReturnType<typeof rpcPeer>;
