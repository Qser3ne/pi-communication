import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
export type Completion = { text: string } | { tool: string; args: Record<string,unknown> };
export type ChatRequest = { model: string; messages: any[]; tools?: any[] };
export async function fakeModel(respond: (request:ChatRequest)=>Completion|Promise<Completion>):Promise<{url:string;close():Promise<void>}> {
  const server=createServer(async(req,res)=>{
    try {
      if(req.method!=='POST'||req.url!=='/v1/chat/completions'){res.writeHead(404).end();return;}
      let body='';for await(const chunk of req){body+=chunk;if(body.length>4*1024*1024)throw new Error('oversized test request');}
      const input=JSON.parse(body) as ChatRequest,result=await respond(input),id='chatcmpl-'+randomUUID();
      res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache'});
      const chunk=(delta:unknown,finish:string|null)=>res.write('data: '+JSON.stringify({id,object:'chat.completion.chunk',created:1,model:input.model,choices:[{index:0,delta,finish_reason:finish}]})+'\n\n');
      if('tool' in result){chunk({role:'assistant',tool_calls:[{index:0,id:'call_'+randomUUID().replaceAll('-',''),type:'function',function:{name:result.tool,arguments:JSON.stringify(result.args)}}]},null);chunk({},'tool_calls');}
      else {chunk({role:'assistant',content:result.text},null);chunk({},'stop');}
      res.end('data: [DONE]\n\n');
    } catch(error){if(!res.headersSent)res.writeHead(500,{'content-type':'application/json'});res.end(JSON.stringify({error:{message:String(error)}}));}
  });
  await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const address=server.address();if(!address||typeof address==='string')throw new Error('bad address');
  return {url:'http://127.0.0.1:'+address.port,async close(){server.closeAllConnections();await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}};
}
export function content(message:any):string { return typeof message?.content==='string'?message.content:(message?.content??[]).map((b:any)=>b.text??'').join('\n'); }
