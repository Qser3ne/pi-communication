export interface Clock { now(): number }
export const LIMITS = { frameBytes: 1024 * 1024, timeoutMs: 5000, connections: 32, inbox: 100, dedup: 1000, dedupMs: 600000, queueMs: 600000, conversations: 1000, conversationMs: 1800000, idle: 32, idleMs: 43200000, idleDebounceMs: 750, rate: 30, rateMs: 60000, controls: 200 } as const;
