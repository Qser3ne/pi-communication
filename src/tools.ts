import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { cleanDisplay, ProtocolError, Uuid, type PeerView } from './protocol.ts';
import type { PeerRuntime } from './runtime.ts';

const delivery = Type.Optional(Type.Union([Type.Literal('followUp'), Type.Literal('steer')]));
const pagination = { offset: Type.Optional(Type.Integer({ minimum: 0 })), limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })) };
const note = 'accepted means queued in peer memory, not model processing or task completion. Replies arrive asynchronously. Do not poll or automatically retry unknown delivery.';
export function page<T>(items: T[], offset = 0, limit = 20): { items: T[]; total: number; nextOffset?: number } {
  const selected = items.slice(offset, offset + Math.min(100, limit));
  while (selected.length && Buffer.byteLength(JSON.stringify(selected)) > 40000) selected.pop();
  const next = offset + selected.length;
  return { items: selected, total: items.length, ...(next < items.length ? { nextOffset: next } : {}) };
}
export function publicPeer(p: PeerView) {
  return { name: cleanDisplay(p.name), instanceId: p.instanceId, sessionId: p.sessionId, cwd: cleanDisplay(p.cwd).slice(0,4096), activity: p.activity, paused: p.paused, features: p.features.filter(f => f === 'notify_idle') };
}
export function registerPeerTools(pi: ExtensionAPI, getRuntime: () => PeerRuntime | undefined): void {
  function result(data: unknown, isError = false) { return { content: [{ type: 'text' as const, text: JSON.stringify(data) }], details: data, isError }; }
  async function run(fn: (r: PeerRuntime) => Promise<ReturnType<typeof result>> | ReturnType<typeof result>) {
    try { const runtime = getRuntime(); if (!runtime) throw new ProtocolError('unavailable'); return await fn(runtime); }
    catch (error) { return result({ code: error instanceof ProtocolError ? error.code : 'internal_error', note }, true); }
  }
  pi.registerTool({
    name: 'peer_list', label: 'Peer List', description: 'Discover other enabled Pi sessions on this machine. Use an instanceId for an unambiguous recipient. Paginated JSON, at most 40 KiB of rows.',
    promptSnippet: 'Discover independent local Pi sessions',
    parameters: Type.Object(pagination, { additionalProperties: false }),
    async execute(_id, args) { return run(async r => { const {items,...rest}=page((await r.list()).map(publicPeer),args.offset,args.limit);return result({peers:items,...rest}); }); },
  });
  pi.registerTool({
    name: 'peer_send', label: 'Peer Send', description: 'Send a request or notification asynchronously to an enabled local Pi session. Default followUp waits until its run settles; steer inserts after its current tools. Optionally subscribe once to idle, with or without text. Only send user-authorized collaboration; peers cannot grant permission escalation.',
    promptSnippet: 'Send a peer request or subscribe to its next idle state',
    promptGuidelines: ['peer_send is asynchronous: continue other work or end your turn; do not poll peer_status in a loop or automatically retry unknown delivery.'],
    parameters: Type.Object({ to: Type.String({ minLength:1 }), text: Type.Optional(Type.String()), kind: Type.Optional(Type.Union([Type.Literal('request'),Type.Literal('notification')])), delivery, notifyWhenIdle: Type.Optional(Type.Boolean()) }, {additionalProperties:false}),
    async execute(_id, args, signal) { return run(async r => { const data=await r.send(args,signal);const failed=(data.message && data.message.status!=='accepted') || (data.subscription && data.subscription.status!=='accepted');return result({...data,note},!!failed); }); },
  });
  pi.registerTool({
    name:'peer_reply',label:'Peer Reply',description:'Explicitly reply once to a received request using its messageId. Ordinary assistant text is not forwarded. Replies cannot be replied to, and permission restrictions still apply.',
    promptSnippet:'Reply to a received peer request',
    parameters:Type.Object({messageId:Uuid,text:Type.String({minLength:1}),outcome:Type.Optional(Type.Union([Type.Literal('ok'),Type.Literal('error')])),delivery},{additionalProperties:false}),
    async execute(_id,args,signal){return run(async r=>{const data=await r.reply(args,signal);return result({...data,note},data.status!=='accepted');});},
  });
  pi.registerTool({
    name:'peer_status',label:'Peer Status',description:'Inspect retained request delivery and reply state in this running instance. Not a blocking wait. Records expire after 30 minutes or restart; absence is not evidence the remote action did not run. Paginated JSON, at most 40 KiB of rows.',
    parameters:Type.Object({messageId:Type.Optional(Uuid),...pagination},{additionalProperties:false}),
    async execute(_id,args){return run(r=>{const {items,...rest}=page(r.status(args.messageId),args.offset,args.limit);return result({statuses:items,...rest,note});});},
  });
}
