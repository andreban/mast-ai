# Implementation Plan: Sub-Agent Approval Architecture

Each issue below leaves the project in a state that builds, lints, and passes
tests. Issues land as separate PRs against `main`, sequenced so reviewers can
trace the refactor in stages — the earliest land additive type changes, the
later replace the registry-wrap mechanism end-to-end. PRs all carry the
`sub-agents` GitHub label.

A reproduction test for issue #128 was drafted during planning
(`it('intercepts approvals for tools called by sub-agents via
createAgentTool', …)` in `packages/react-ui/src/approval.test.tsx`) and
verified to fail against the current code. It is held in a working tree —
not committed to `main` — until Issue 4 brings the rest of the rewrite. It
lands as part of that PR, going from non-existent to green in a single
commit.

---

## Issue 1 — Core: approval primitive types

Land the new public types in `@mast-ai/core` without any behavior change. The
types compile and are exported, but nothing in the runner or tools consumes
them yet. This is the smallest reviewable starting point.

**`packages/core/src/tool.ts`**

- Add `ApprovalRequest`, `ApprovalResponse` (tagged union with `approve` /
  `reject`), and the `ApprovalResponse` helper namespace (`approve()`,
  `reject(result?)`).
- Add `ApprovalHandler` interface with the single
  `requestApproval(req): Promise<ApprovalResponse>` method.
- Extend `ToolContext` with the optional `approvalHandler?: ApprovalHandler`
  field.

**`packages/core/src/error.ts` (or new file)**

- Add and export `APPROVAL_CANCELLED_RESULT = 'User cancelled the tool call.'`
  as a documented constant. Place wherever shared constants currently live.

**`packages/core/src/index.ts`**

- Re-export the new types and constant.

**`packages/core/src/tool.test.ts`**

- Type-level smoke tests: assert the helper namespace returns the expected
  shape, and that `ApprovalResponse` narrows correctly in a `switch`.

No behaviour change. `ToolContext.approvalHandler` is set by no one and read
by no one; the field exists for Issue 2 to populate.

**Branch:** `feat/sub-agents/approval-types`

---

## Issue 2 — Core: runner-level gating

Wire `AgentRunner` to consult an `ApprovalHandler` for `requiresApproval`
tools and to thread the handler into `ToolContext`. Adds the gating contract
that `react-ui` will plug into in Issue 4.

**`packages/core/src/runner.ts`**

- Add `approvalHandler?: ApprovalHandler` field on `AgentRunner` (mutable —
  consumers may attach a default after construction).
- Add `_approvalHandler?: ApprovalHandler` field on `RunBuilder` plus
  `withApprovalHandler(handler): this` setter.
- In `executeStream`, resolve the active handler via
  `builder._approvalHandler ?? this.approvalHandler`. Before each tool call:
  - If `def.requiresApproval` is `true` and a handler is attached, call
    `handler.requestApproval({ name, args })`.
  - On `{ type: 'reject', result? }`: return `result ?? APPROVAL_CANCELLED_RESULT`
    as the tool result; emit `tool_call_completed` with `error: false`.
    UI status mapping is the consumer's responsibility (react-ui sets
    `'cancelled'` in Issue 4).
  - On `{ type: 'approve' }`: proceed to `tool.call`.
- When invoking `tool.call`, pass `approvalHandler: handler` in the
  `ToolContext`.

**`packages/core/src/runner.test.ts`**

- `requiresApproval: false` tools never call the handler.
- `requiresApproval: true` with no handler attached executes as today
  (ungated).
- Handler returning `approve` runs the tool; `reject` skips and returns the
  default cancelled string; `reject(result)` skips and returns `result`.
- Handler attached via `RunBuilder.withApprovalHandler` overrides the
  runner's default for that run only.
- Runner-level default is consulted when no per-run handler is set.
- `ToolContext.approvalHandler` is set to the active handler when
  `tool.call` is invoked. Verified by a stub tool that records its
  context.

**Branch:** `feat/sub-agents/runner-gating`
**Depends on:** Issue 1

---

## Issue 3 — Core: Conversation options and `createAgentTool` propagation

Plumb the handler through the high-level entry points. `Conversation` carries
the handler from its creation site (where `AgentProvider` will attach it in
Issue 4) into every `runStream` call. `createAgentTool` forwards
`ctx.approvalHandler` into child runs unless the child runner defines its own.

**`packages/core/src/conversation.ts`**

- Add `ConversationOptions { approvalHandler?: ApprovalHandler }`.
- Constructor accepts `options: ConversationOptions = {}`; store as a
  private field.
- `buildStream` calls `builder.withApprovalHandler(this.options.approvalHandler)`
  when set.

**`packages/core/src/runner.ts`**

- `AgentRunner.conversation(agent, options?: ConversationOptions)` overload.

**`packages/core/src/agentTool.ts`**

- In `tool.call`, after constructing the child `RunBuilder` and forwarding
  the context:
  ```ts
  if (context.approvalHandler && !runner.approvalHandler) {
    builder.withApprovalHandler(context.approvalHandler);
  }
  ```

**`packages/core/src/conversation.test.ts`** (new tests)

- `runner.conversation(agent, { approvalHandler })` propagates the handler
  to every `runStream` call.

**`packages/core/src/agentTool.test.ts`** (new tests)

- Sub-agent inherits `ctx.approvalHandler` when the child runner has no
  default. A `requiresApproval: true` tool registered on the child
  triggers the inherited handler.
- Sub-agent uses the child runner's own `approvalHandler` when set —
  inherited handler is _not_ called for child tools.
- Sub-agent runs ungated when neither `ctx.approvalHandler` nor the child
  runner's handler is present (today's behaviour for unattached runs).

**Branch:** `feat/sub-agents/conversation-and-agenttool`
**Depends on:** Issue 2

---

## Issue 4 — react-ui: switch `AgentProvider` to handler-based gating

Replace the `withApprovalProxy` registry-wrap mechanism with a per-run
`ApprovalHandler`. Removes the shadow `AgentRunner` construction. Updates
`PendingApproval` to its simpler shape.

**`packages/react-ui/src/approval.ts`**

- Delete `ApprovalProxyTool`.
- Delete `ApprovalProxyHooks`.
- Delete `withApprovalProxy`.
- Keep `INLINE_APPROVAL`, `OnApprovalRequired`, `computeNeedsApproval` —
  their public contracts are unchanged.
- Update `PendingApproval`:
  - Drop `respondWith`.
  - Change `reject` to `(result?: string) => void`.
- Add a small factory that builds an `ApprovalHandler` from the React-side
  refs (callback prop, override prop, inline queue resolver, awaiting/state
  setters). The factory's `requestApproval` body is the logic currently
  living inside `ApprovalProxyTool.call`, retargeted to return
  `ApprovalResponse`.

**`packages/react-ui/src/context.tsx`**

- Remove the `wrappedRunner = new AgentRunner(runner.adapter, provider)`
  block. Use the user's `runner` directly.
- Build the `ApprovalHandler` once via `useMemo` and pass it as
  `runner.conversation(agent, { approvalHandler })`.
- Inline approval enqueue resolves with `boolean | string`; the handler
  factory translates that into `ApprovalResponse` (true → approve, false
  → reject(), string → reject(string)).
- `reset()` keeps the existing semantics: reject in-flight approvals so
  the run terminates.

**`packages/react-ui/src/approval.test.tsx`**

- All existing tests retained and updated for the new mechanism. The two
  semantic changes the suite must reflect:
  - A string returned from `OnApprovalRequired` now lands as
    `status: 'cancelled'` (was previously not status-tagged). Existing
    tests asserting "respondWith string ⇒ status success" become
    "reject string ⇒ status cancelled".
  - `pendingApprovals[i].respondWith(text)` test cases migrate to
    `pendingApprovals[i].reject(text)`.
- The pre-landed regression test for #128 flips from failing to passing.
- Two new tests:
  - **Independent runner inherits**: child runner with its own
    `AgentRunner` instance and no `approvalHandler` of its own surfaces
    approvals to the parent's `<AgentProvider>` (handler attached on the
    parent `Conversation`, propagated through `ToolContext`).
  - **Isolated child handler wins**: child runner's
    `approvalHandler` is consulted (and the parent's is not) when set.

**`packages/react-ui/src/index.ts`**

- Stop re-exporting any of the removed proxy types (verify nothing did so
  already; clean up if it did).

**Branch:** `feat/sub-agents/react-ui-rewrite`
**Depends on:** Issue 3

---

## Issue 5 — Documentation refresh

Update the library-level and react-ui-level docs so they describe the new
architecture. The sub-agents subdirectory PRD and SPEC stay where they are
during this issue; they move to `docs/archive/` in Issue 6.

**`docs/PRD.md`**

- §3 (Recursive Sub-Agents): clarify that approval policy travels with the
  _run_, not the runner — sub-agents on independent runners still surface
  approvals to the parent's UI.

**`docs/SPEC.md`**

- `ToolContext` section: document `approvalHandler` field and its
  propagation contract.
- Add a brief note that `requiresApproval` gating is enforced by the
  runner when a handler is attached, replacing the previous "react-ui
  enforces this via a registry wrap" framing.

**`docs/react-ui/SPEC.md`**

- §9.1–9.3: rewrite to describe the per-run handler model. Replace the
  "proxy intercepts the registry" prose with the runner-gating prose.
- Update the `PendingApproval` shape (drop `respondWith`).
- Note the semantic change for `OnApprovalRequired` returning a string.

**`docs/react-ui/USAGE.md`**

- Audit for any reference to `respondWith` or the legacy "string ⇒
  substituted success" behaviour. Update to match.

**`docs/sub-agents/MIGRATION.md`**

- Pin the version numbers in §2 ("No-op migrations") and §9 ("Rolling
  back") to the actual release tags now that we know them.
- Cross-link the release notes once the tag exists.

No code changes in this issue. Doc-only PR.

**Branch:** `docs/sub-agents/refresh`
**Depends on:** Issue 4

---

## Issue 6 — Archive sub-agents docs and close out

Final housekeeping. Run after all earlier issues have shipped to `main` and
the next release is cut.

- Move `docs/sub-agents/` to `docs/archive/sub-agents/` (per the CLAUDE.md
  rule about archived feature docs).
- Verify the `gh issue close #128` happened automatically via the
  `Closes #128` line in the Issue 4 PR body.
- Remove the `sub-agents` label from open issues if any drift remains.

**Branch:** `chore/sub-agents/archive`
**Depends on:** Issue 5 + a release cut that includes Issues 1–4

---

## Release strategy

The cumulative effect of Issues 1–4 is a coordinated breaking change to
`@mast-ai/core` (new `ToolContext` field, new exports) and `@mast-ai/react-ui`
(`PendingApproval` shape change, internal proxy removal). Per the lockstep
release policy, a single minor version bump covers both packages once Issue 4
is merged. Cut the release after Issue 5 lands so the published docs match
the published code.

The `OnApprovalRequired` callback-string semantic change is a
behaviour-level breaking change but a typing-level minor change (the return
type union is unchanged). Call out in the release notes.

---

## Out-of-scope follow-ups

These are not part of this plan but worth noting for future work:

- A standalone `<SubAgentProvider>` for declarative attachment of independent
  sub-agent runners to the same UI surface.
- Approval events on the `AgentEvent` stream (an alternative to the callback
  shape — explored in PRD §8 and rejected for v1).
- Multi-tenant approval surfaces (one runner reporting to multiple UIs).
- Migration to strict semver post-1.0; today the minor-version bump covers
  the breaking surface change.
