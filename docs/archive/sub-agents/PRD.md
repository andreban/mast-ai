# Product Requirements Document: Sub-Agent Approval Architecture

## 1. Summary

Approvals — the human-in-the-loop confirmation step that gates execution of
tools flagged `requiresApproval: true` — are currently implemented as a wrapper
around a single `AgentRunner`'s registry. The wrap is invisible to anything
that captured the original runner reference, so a sub-agent invoked through
`createAgentTool` bypasses the policy entirely.

This document scopes a refactor that moves approval handling out of the
registry-wrap layer and into the runner itself, with the policy propagated to
sub-agent runs through `ToolContext`. The goal is an architecture where
sub-agents are first-class — fully independent runners with their own adapter,
registry, and tools — yet approvals still surface to the same UI surface as
the parent's tool calls.

The work is tracked in `gh issue #128`. The bug is a symptom; this PRD scopes
the architectural change that fixes it cleanly.

## 2. Problem Statement

Today's approval flow looks like this:

```
┌──────────────────────────────────────────────────────────────────┐
│                          User code                               │
│                                                                  │
│   const tool = createAgentTool(runner, CHILD, { ... });          │
│   registry.register(tool);          captures `runner` ─────┐     │
│                                                            │     │
│   <AgentProvider runner={runner} agent={PARENT}>           │     │
│             │                                              │     │
│             │ wraps registry, builds NEW runner            │     │
│             ▼                                              │     │
│        wrappedRunner = new AgentRunner(adapter, W(reg))    │     │
│        ▲                                                   │     │
│        │ runs PARENT through wrap                          │     │
│        │                                                   │     │
│   PARENT calls `delegate` → tool.call(args, ctx) ──────────┘     │
│                                  │                               │
│                                  ▼                               │
│                  runner.runBuilder(CHILD)  ← UNWRAPPED runner    │
│                  CHILD's tools resolve through original registry │
│                  → sensitive tools execute WITHOUT approval      │
└──────────────────────────────────────────────────────────────────┘
```

Three architectural shortcomings cause this:

1. **Approval lives at the registry layer.** `AgentProvider` wraps
   `runner.registry` with a `ToolProvider` that intercepts `getTool(name)` and
   decorates flagged tools. The wrap is bound to one specific runner instance.
2. **`createAgentTool` captures the runner at factory time.** The reference is
   the _unwrapped_ one, so sub-agent runs bypass the wrap.
3. **Sub-agent runners are not independent.** The current shape effectively
   forces sub-agents to share the parent's runner if they want approvals to
   flow. Configuring a sub-agent with its own adapter and registry breaks the
   approval path entirely.

The library's PRD §3 promises "Recursive Sub-Agents… each sub-agent may run in
any execution mode independently of its parent." Approval policy is currently
the load-bearing exception to that promise.

## 3. Goals

- **Independent sub-agent runners.** A sub-agent must be able to use its own
  adapter, registry, and toolset, fully decoupled from the parent runner, and
  still surface approvals to the same UI.
- **Approval as a per-run policy.** The decision of "should this tool call
  pause for human confirmation?" is configured at run time, not bolted onto
  the registry.
- **Inheritance through `ToolContext`.** A sub-agent run inherits the active
  approval handler from the tool call that invoked it, so the common case
  (one UI, many runners) works with zero extra wiring.
- **Explicit override.** A consumer can attach a different handler to a child
  run when they want isolation between parent and child approval surfaces.
- **Drop the wrapped-runner pattern.** `AgentProvider` no longer constructs a
  shadow `AgentRunner`. The user's runner reference is the runner that runs.

## 4. Non-Goals

- **Changing the user-facing `AgentProvider` props.** `onApprovalRequired`,
  `approvalOverride`, `INLINE_APPROVAL`, and `useAgent().pendingApprovals` keep
  their current shapes and semantics.
- **Backwards compatibility for internals.** The library is pre-1.0 and the
  internal `withApprovalProxy` / `ApprovalProxyTool` types are not part of the
  public surface (they are not re-exported from `react-ui/src/index.ts`).
- **Multi-conversation provider.** Mounting one `<AgentProvider>` per
  conversation remains the supported pattern.
- **A registry of "all runners in the app."** The provider does not maintain a
  catalogue of runners. Sub-agent runners inherit through `ToolContext`; if a
  consumer wants explicit attachment, they call the runner's own configuration
  method.

## 5. User Stories

### 5.1 Same runner, sub-agent through `createAgentTool` (the #128 bug)

> As a developer building a planner+coder topology where both agents share a
> runner, I want approvals on the coder's tools to surface to the same UI as
> the planner's tools, with no extra wiring beyond the existing
> `<AgentProvider>` mount.

```ts
const runner = new AgentRunner(adapter, registry);
registry.register(createAgentTool(runner, CODER, { name: 'delegate', ... }));

<AgentProvider runner={runner} agent={PLANNER}>
  <ConversationPanel />
</AgentProvider>
```

The CODER's `requiresApproval: true` tools must trigger
`onApprovalRequired` — currently they do not.

### 5.2 Independent runner, shared approval surface

> As a developer running a sub-agent on a different adapter (e.g. a privacy-
> sensitive child on Gemini Nano while the parent runs on Gemini 2.5 Flash via
> URP), I want both runs to surface approvals to the same `<AgentProvider>`
> UI without coupling their adapters.

```ts
const parentRunner = new AgentRunner(remoteAdapter, parentRegistry);
const childRunner  = new AgentRunner(nanoAdapter,   childRegistry);

parentRegistry.register(createAgentTool(childRunner, CHILD, { ... }));

<AgentProvider runner={parentRunner} agent={PARENT}>
  <ConversationPanel />
</AgentProvider>
```

The CHILD's flagged tool calls must surface in `pendingApprovals` of the same
provider as the parent's, even though the runners share nothing else.

### 5.3 Independent runner, isolated approval surface

> As a developer embedding a sub-agent with its own approval policy (e.g.
> a tool-builder that auto-approves everything because it runs in a sandbox),
> I want to attach a separate handler to the child runner that takes
> precedence over the parent's.

The child run uses the explicitly configured handler; the parent's handler is
not consulted for the child's tool calls.

## 6. Functional Requirements

1. **Approval gating moves into `AgentRunner`.** Before invoking a tool flagged
   `requiresApproval: true` (with the runtime `approvalOverride` rules
   applied), the runner consults the active handler and acts on its decision.
2. **Approval policy is attached to a run.** `RunBuilder.withApprovalHandler`
   sets the handler for that run. `Conversation` accepts the handler at
   construction time and threads it through every `runStream` call.
3. **Policy propagation through `ToolContext`.** When the runner invokes a
   tool, it passes `approvalHandler` in `ToolContext`. `createAgentTool`
   forwards the inherited handler to the child run unless an explicit handler
   is configured on the child runner.
4. **`createAgentTool` keeps its current signature.** It still takes
   `(runner, agent, options)`. The runner argument continues to mean "the
   adapter+registry the child will use." Approval policy is no longer the
   runner's job to capture.
5. **`AgentProvider` no longer constructs a shadow runner.** The user's
   `runner` is the one that runs. `AgentProvider` configures the handler on
   each run it kicks off via the `Conversation` it owns.
6. **Sub-agents not invoked from a parent run still work.** A standalone
   `runner.run(...)` with no approval handler attached either auto-approves
   `requiresApproval` tools (preserving today's "no callback ⇒ enqueue inline"
   default behavior is the responsibility of the consumer that attached the
   handler).

## 7. Success Criteria

1. **#128 reproduction test passes.** A `createAgentTool`-mediated sub-agent
   with a `requiresApproval: true` tool fires `onApprovalRequired` for the
   inner call.
2. **Independent-runner test passes.** A sub-agent on a different runner
   instance (different adapter, different registry) still surfaces approvals
   to the parent's `<AgentProvider>`.
3. **Isolated-handler test passes.** A child runner with an explicitly
   configured handler does not consult the parent's handler.
4. **No registry mutation.** `AgentProvider` does not modify the user's
   `runner.registry`. The `registry` field stays `readonly`.
5. **`withApprovalProxy` is removed** from `@mast-ai/react-ui`. Equivalent
   tests in `approval.test.tsx` continue to pass against the new mechanism.
6. **Public surface preserved.** `AgentProvider` props, `useAgent()` return
   shape, `INLINE_APPROVAL` sentinel, and `PendingApproval` interface are
   unchanged.

## 8. Out of Scope (this revision)

- A standalone `<SubAgentProvider>` component for declarative attachment of
  child runners. Inheritance through `ToolContext` covers the common cases;
  declarative attachment can be added later without API churn.
- An `approval` event in the `AgentEvent` stream. The current callback shape
  is sufficient; emitting events instead would require defining back-channel
  semantics for the decision and risks introducing stream-consumer
  responsibility for resolution.
- Multi-tenant approval surfaces (one runner reporting to multiple UIs).
  Consumers needing this can fan out from a single handler.
