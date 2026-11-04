import { describe, expect, it } from 'vitest';
import { createConversations } from '../../src/conversations.ts';
import { identity, message } from '../helpers/fixtures.ts';
import type { MessageEnvelope } from '../../src/protocol.ts';
describe('request correlation',()=>{
  it('accepts only a reply from the requested instance and does not regress on late receipts',()=>{
    const self=identity('A'),other=identity('B'),c=createConversations(self,{now:()=>0});
    const req=message({from:self,to:other});c.recordOutgoing(req);
    const reply:MessageEnvelope={...message({from:other,to:self}),kind:'reply',replyTo:req.messageId,outcome:'ok'};
    expect(()=>c.validateIncoming({...reply,from:identity()})).toThrow('bad_reply');
    c.validateIncoming(reply);c.recordIncoming(reply);
    c.recordTransmission(req.messageId,{messageId:req.messageId,status:'accepted'});
    c.applyReceipt({version:1,kind:'receipt',messageId:identity().sessionId,from:other,to:self,originalMessageId:req.messageId,state:'submitted'});
    expect(c.getStatus(req.messageId)[0]).toMatchObject({response:'replied',replyMessageId:reply.messageId,outcome:'ok',delivery:'submitted'});
    expect(()=>c.validateIncoming({...reply,messageId:identity().sessionId})).toThrow('bad_reply');
  });
  it('keeps terminal receipts stable when delayed submitted receipts arrive',()=>{
    const self=identity('A'),other=identity('B'),c=createConversations(self,Date),req=message({from:self,to:other});
    c.recordOutgoing(req);
    const receipt={version:1 as const,kind:'receipt' as const,messageId:identity().sessionId,from:other,to:self,originalMessageId:req.messageId,state:'expired' as const};
    c.applyReceipt(receipt);c.recordTransmission(req.messageId,{messageId:req.messageId,status:'accepted'});
    c.applyReceipt({...receipt,state:'submitted'});
    expect(c.getStatus(req.messageId)[0]?.delivery).toBe('expired');
  });
  it('reserves one explicit reply attempt and cannot reply to a reply or notification',()=>{
    const self=identity('B'),c=createConversations(self,{now:()=>0}),req=message({to:self});
    c.validateIncoming(req);c.recordIncoming(req);
    const reply=c.makeReply(req.messageId,'done','ok','steer');
    expect(reply).toMatchObject({kind:'reply',replyTo:req.messageId,from:self,to:req.from,delivery:'steer',text:'done'});
    expect(()=>c.makeReply(req.messageId,'again','ok','followUp')).toThrow('bad_reply');
    const notification=message({to:self,kind:'notification'});c.recordIncoming(notification);
    expect(()=>c.makeReply(notification.messageId,'again','ok','followUp')).toThrow('bad_reply');
  });
  it('expires waiting records without claiming cancellation and rejects late replies',()=>{
    let now=0;const self=identity(),c=createConversations(self,{now:()=>now}),req=message({from:self});c.recordOutgoing(req);
    c.recordTransmission(req.messageId,{messageId:req.messageId,status:'unknown',code:'connection_closed'});
    expect(c.getStatus(req.messageId)[0]?.delivery).toBe('unknown');
    now=1800000;const expired=c.expire();expect(expired[0]?.response).toBe('expired');expect(expired[0]?.delivery).toBe('unknown');
    expect(c.getStatus(req.messageId)).toEqual([]);
    expect(()=>c.validateIncoming({...message({from:req.to,to:self}),kind:'reply',replyTo:req.messageId,outcome:'ok'})).toThrow('bad_reply');
  });
  it('rejects uncorrelated receipts and bounds live associations',()=>{
    const self=identity(),c=createConversations(self,{now:()=>0}),req=message({from:self});c.recordOutgoing(req);
    c.applyReceipt({version:1,kind:'receipt',messageId:identity().sessionId,from:identity(),to:self,originalMessageId:req.messageId,state:'submitted'});
    expect(c.getStatus(req.messageId)[0]?.delivery).toBe('sending');
    for(let n=1;n<1000;n++)c.recordOutgoing(message({from:self}));
    expect(()=>c.recordOutgoing(message({from:self}))).toThrow('capacity');
  });
});
