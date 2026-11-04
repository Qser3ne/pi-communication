# 实施取舍与审查结论

以下按作出顺序保留实施账本中的全部裁决（包含代价），供合并时查阅。

1. Ruling: Execute approved isolation via a new Git repo and local worktree — no existing repository/code to disturb — cost if wrong: worktree must be integrated before root-directory installation.

2. Ruling: Copy non-executable skill helper scripts to a private /tmp directory and set execute bits on copies — preserve installed skills while running required helpers — cost: temporary helper directory needs eventual cleanup.

3. Task 1: Ruling: pnpm 12 ignores package.json pnpm settings; use generated pnpm-workspace.yaml build allowlist (esbuild only) — reproducible install without blanket script approval — cost: requires pnpm 12 configuration support.

4. Task 3: Ruling: use bounded byte buffers and fatal UTF-8 decoding at LF rather than StringDecoder internals — lastNeed is not a public typed API and byte limits stay exact — cost: one bounded frame buffer copy per chunk.

5. Task 4: Ruling: reject concurrent messageId collision from different senders in local pending queue — Pi context accounting uses messageId and ambiguity must not release wrong work — cost: exceedingly unlikely UUID collision is rejected rather than accepted. Added drop(messageId) for production injection-failure cleanup.

6. Task 5: Ruling: store a reply attempt under its inbound request association instead of consuming a second capacity slot — a full request table must still permit replies — cost: status(replyId) uses a bounded lookup; public request/reply semantics unchanged.

7. Task 6: Ruling: info() exposes a sanitized self-view for the UI; runtime resolves pinned recipients from live registry for every operation, never from arbitrary model addresses. Source metadata stays user-role text with explicit provenance, not a permission boundary — cost: repeated discovery latency; model still must enforce its session permissions.

8. Task 7: Ruling: clear idle debounce on agent_start and business admission — a new run must invalidate a previously scheduled idle notice — cost if wrong: a missed final-settled event delays notification until the periodic eligibility check.

9. Task 8: Ruling: add optional offset/limit pagination to peer_list and peer_status with a 40 KiB row budget — keep model output bounded and valid JSON rather than silently truncating JSON — cost if wrong: callers need an additional page for large lists.

10. Task 9: Ruling: accept Pi-native custom session IDs (letters/numbers/dot/underscore/dash, bounded 256 characters), keeping all endpoint/key paths keyed exclusively by generated instance UUIDs — real CLI supports --session-id review.session-42 and UUID-only validation silently disabled the extension — cost if wrong: custom IDs longer than 256 are still unsupported; no path access is added. E2E reproduced failure before the schema change.

11. Task 9: Ruling: canonicalize only the OS-owned /tmp root before checking private socket paths — macOS /tmp is a system symlink, while peer-controlled symlinks must remain rejected — cost if wrong: canonical root availability is required; native macOS remains unverified. Simulated RED→GREEN path test added.

12. Task 9: Ruling: automate the two interactive terminals through POSIX PTYs rather than claim human visual inspection — actual TUI commands, selectors, Esc, source rendering and cleanup are exercised reproducibly with the fake model — cost if wrong: layout/theme issues not detectable from text and registry assertions may remain; explicitly documented as not human visual sign-off.

13. Final: Ruling: native macOS and human visual acceptance remain unverified — Linux/PTy evidence is not cross-platform or human signoff — cost if wrong: platform/layout-specific defects may remain.

14. Final: Ruling: real-model compliance and same-user isolation are not claimed — fake-model mechanics and file permissions cannot establish either — cost if wrong: operators must maintain permission checks and trust the local OS user.

15. Final: Ruling: Windows, remote transport, restart persistence remain non-goals — no scope expansion during review — cost: these use cases are unsupported.

16. Final: Ruling: Pi 1.5 is the tested host contract, not every future version — runtime lower-bound guard follows approved compatibility policy — cost: future Pi API changes may need a new compatibility release.

17. Final: Ruling: independently rerun regressions and complete suite here, not in reviewer — reviewer lacked execution tools; parent owns acceptance — cost: no second independent execution environment.

18. Final: Ruling: dependency vulnerability audit is outside this implementation acceptance — review checked lockfile sanity only — cost: no security-audit assurance for transitive dependencies.

19. Final: Ruling: use abort-signal maintenance tracking and a one-second eligibility sweep for operations without agent_settled — Pi success callbacks fire before clearing busy state, so waiting for actual idle is safer — cost: up to roughly one second extra delivery latency; steer is held through compaction/tree maintenance.

## 暂缓小问题

- 关闭或取消期间，全注册表发现不可中途取消，可能超过名义上的一秒控制消息关闭期限。单次探测仍有超时，无业务自动重试。

## 最终证据

独立整体审查后修复了压缩/树导航调度、异步 settled FIFO、TUI 多行来源伪造。54 个测试（35 单元、10 集成、9 E2E）、TypeScript 和 git diff --check 均通过。详细范围见 [acceptance.md](acceptance.md)。没有声称原生 macOS、真实模型、人工视觉或依赖漏洞审计已通过。
