import { describe, expect, it } from 'vitest';
import { createInbox } from '../../src/inbox.ts';
import { identity, message } from '../helpers/fixtures.ts';
describe('bounded inbox',()=>{
  it('deduplicates content before applying rate limits, rejecting conflicting reuse',()=>{
    const inbox=createInbox({now:()=>0});const m=message();
    expect(inbox.admit(m).status).toBe('accepted');
    for(let n=0;n<40;n++)expect(inbox.admit(m).status).toBe('accepted');
    expect(inbox.admit({...m,text:'changed'}).code).toBe('id_conflict');
    expect(inbox.take('followUp')?.messageId).toBe(m.messageId);expect(inbox.take('followUp')).toBeUndefined();
  });
  it('does not free capacity until context observation and never frees it twice',()=>{
    const inbox=createInbox({now:()=>0});const senders=Array.from({length:4},()=>identity());
    const messages=Array.from({length:100},(_,n)=>message({from:senders[n%4]}));
    for(const m of messages)expect(inbox.admit(m).status).toBe('accepted');
    expect(inbox.admit(message()).code).toBe('queue_full');
    const taken=inbox.take('followUp')!;inbox.markSubmitted(taken.messageId);
    expect(inbox.admit(message()).code).toBe('queue_full');
    inbox.observeContext([taken.messageId,taken.messageId]);
    expect(inbox.admit(message()).status).toBe('accepted');
    expect(inbox.admit(message()).code).toBe('queue_full');
  });
  it('limits senders separately and resumes after the rate window',()=>{
    let now=0;const inbox=createInbox({now:()=>now}),from=identity();
    for(let n=0;n<30;n++)expect(inbox.admit(message({from})).status).toBe('accepted');
    expect(inbox.admit(message({from})).code).toBe('rate_limited');
    expect(inbox.admit(message()).status).toBe('accepted');
    now=60000;expect(inbox.admit(message({from})).status).toBe('accepted');
  });
  it('pauses admission and dequeue, preserves FIFO, expires queued but not submitted messages',()=>{
    let now=0;const inbox=createInbox({now:()=>now});
    const a=message(),b=message(),c=message({delivery:'steer'});
    for(const m of [a,b,c])inbox.admit(m);
    expect(inbox.take('steer')?.messageId).toBe(c.messageId);inbox.markSubmitted(c.messageId);
    inbox.setPaused(true);expect(inbox.admit(message()).code).toBe('paused');expect(inbox.take('followUp')).toBeUndefined();
    inbox.setPaused(false);expect(inbox.take('followUp')?.messageId).toBe(a.messageId);inbox.markSubmitted(a.messageId);
    now=600000;expect(inbox.expire().map(m=>m.messageId)).toEqual([b.messageId]);
    expect(inbox.hasPending()).toBe(true);inbox.observeContext([a.messageId,c.messageId]);expect(inbox.hasPending()).toBe(false);
    expect(inbox.drain()).toEqual([]);
  });
  it('bounds retained dedup state rather than evicting protected records',()=>{
    const inbox=createInbox({now:()=>0});
    for(let n=0;n<1000;n++){const m=message();expect(inbox.admit(m).status).toBe('accepted');inbox.take('followUp');inbox.markSubmitted(m.messageId);inbox.observeContext([m.messageId]);}
    expect(inbox.admit(message()).code).toBe('capacity');
  });
});
