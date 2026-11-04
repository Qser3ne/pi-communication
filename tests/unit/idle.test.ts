import { describe, expect, it } from 'vitest';
import { createIdleSubscriptions } from '../../src/idle.ts';
import { identity } from '../helpers/fixtures.ts';
describe('one-shot idle subscriptions',()=>{
  it('correlates target and ID and consumes a notice only once',()=>{
    const a=identity('A'),b=identity('B'),sender=createIdleSubscriptions(a,{now:()=>0}),receiver=createIdleSubscriptions(b,{now:()=>0});
    const sub=sender.subscribe(b);receiver.accept(sub);
    expect(receiver.takeNotices('idle',false)).toEqual([]);
    const notice=receiver.takeNotices('idle',true)[0]!;
    expect(sender.receive({...notice,from:identity()})).toBe(false);
    expect(sender.receive(notice)).toBe(true);expect(sender.receive(notice)).toBe(false);
    expect(receiver.takeNotices('idle',true)).toEqual([]);
  });
  it('bounds unique peers, replaces same-peer subscriptions, and expires without retry',()=>{
    let now=0;const self=identity(),idle=createIdleSubscriptions(self,{now:()=>now}),target=identity();
    idle.subscribe(target);const replacement=idle.subscribe(target);
    for(let n=1;n<32;n++)idle.subscribe(identity());
    expect(()=>idle.subscribe(identity())).toThrow('capacity');
    now=43200000;const expired=idle.expire();
    expect(expired).toHaveLength(32);expect(expired.some(n=>n.subscriptionId===replacement.subscriptionId)).toBe(true);
    expect(idle.expire()).toEqual([]);
  });
  it('returns exit notifications for subscribed senders and clears all state',()=>{
    const self=identity(),sender=createIdleSubscriptions(identity(),{now:()=>0}),idle=createIdleSubscriptions(self,{now:()=>0});
    idle.accept(sender.subscribe(self));
    expect(idle.takeNotices('exited',true)[0]).toMatchObject({state:'exited',from:self});
    idle.clear();expect(idle.takeNotices('idle',true)).toEqual([]);
  });
});
