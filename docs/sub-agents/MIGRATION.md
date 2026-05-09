# Migration Guide: Sub-Agent Approval Architecture

Audience: any app using `@mast-ai/core` or `@mast-ai/react-ui` from the
release that introduces sub-agent approvals (see PLAN.md §"Release strategy").

The architecture change moves approval gating from a `react-ui` registry-wrap
into core, expressed as a per-run `ApprovalHandler` propagated through
`ToolContext`. Most apps need no code changes; a handful need a small,
mechanical rewrite. This guide walks through every scenario.

## TL;DR

| Your app's situation                                              | Action required                                                                                                                                       |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mounts `<AgentProvider>`, no other approval-related code          | None                                                                                                                                                  |
| Calls `pendingApprovals[i].respondWith(text)`                     | Rename to `reject(text)`                                                                                                                              |
| `onApprovalRequired` returns a `string`                           | Verify the new semantics fit ([§4](#4-onapprovalrequired-callbacks-that-return-a-string))                                                             |
| Hit by issue #128 (sub-agent skips approval)                      | Bug auto-fixes — no code changes                                                                                                                      |
| Uses `createAgentTool` with a child runner on a different adapter | Sub-agent now correctly inherits the UI approval surface ([§6](#6-sub-agents-on-independent-runners)) — no required changes; new capability available |
| Imports `withApprovalProxy` from `@mast-ai/react-ui`              | Replace with `runner.conversation(agent, { approvalHandler })` ([§7](#7-replacing-withapprovalproxy))                                                 |
| Builds a custom equivalent of `<AgentProvider>`                   | Replace the registry wrap with handler-on-conversation ([§7](#7-replacing-withapprovalproxy))                                                         |

---

## 1. What's new

Three primitives are added to `@mast-ai/core` and re-exported from
`@mast-ai/react-ui`:

```ts
interface ApprovalRequest {
  name: string;
  args: unknown;
}

type ApprovalResponse = { type: 'approve' } | { type: 'reject'; result?: string };

interface ApprovalHandler {
  requestApproval(req: ApprovalRequest): Promise<ApprovalResponse>;
}
```

Plus the helper namespace `ApprovalResponse.approve()` /
`ApprovalResponse.reject(result?)` for ergonomics.

Three places now accept an `ApprovalHandler`:

1. **`runner.conversation(agent, { approvalHandler })`** — every run on this
   conversation uses the handler.
2. **`runner.runBuilder(agent).withApprovalHandler(handler)`** — single-run
   override.
3. **`runner.approvalHandler = handler`** — runner-level default for any run
   without an explicit handler.

When invoking a tool, the runner threads the active handler into
`ToolContext.approvalHandler`. Tools that internally start a sub-agent run —
`createAgentTool` and any custom equivalents — forward this to the child run
unless the child runner has its own default.

---

## 2. No-op migrations

If your app only mounts `<AgentProvider>` and doesn't reach into approval
internals, you don't need to change any code. Bump the package versions and
re-run your tests.

```diff
- "@mast-ai/core": "0.6.0",
- "@mast-ai/react-ui": "0.6.0",
+ "@mast-ai/core": "0.7.0",
+ "@mast-ai/react-ui": "0.7.0",
```

(Replace versions with the actual release. See PLAN.md §"Release strategy".)

What you get for free: any `createAgentTool`-mediated sub-agent in your app
now correctly fires `onApprovalRequired` for child tool calls flagged
`requiresApproval: true`. This was the bug behind issue #128.

---

## 3. `pendingApprovals[i].respondWith(...)` → `reject(...)`

The `PendingApproval` interface drops the `respondWith` method. The same
behaviour — "skip execution, supply this string as the tool result" — is
expressed as `reject(result)`:

```diff
  // Custom approval card resolving with a synthetic result:
  function MyCard({ approval }: { approval: PendingApproval }) {
    return (
      <button
-       onClick={() => approval.respondWith('Operation simulated.')}
+       onClick={() => approval.reject('Operation simulated.')}
      >
        Use canned response
      </button>
    );
  }
```

The model still sees the same string as the tool result. The UI status now
renders as `'cancelled'` instead of going unstyled — see §4 for the
implications.

---

## 4. `OnApprovalRequired` callbacks that return a string

If your `onApprovalRequired` callback returns a `string`, its meaning shifts
slightly:

|                         | Before                              | After               |
| ----------------------- | ----------------------------------- | ------------------- |
| Tool execution          | Skipped                             | Skipped             |
| Result the model sees   | The returned string                 | The returned string |
| `ToolEventEntry.status` | Unstyled (defaulted to `'success'`) | `'cancelled'`       |

For most apps this is fine — the model's behaviour is identical. The
visible difference is in the UI: the tool entry renders with the cancelled
styling instead of success styling.

If you were leaning on the previous "string ⇒ looks like success" behaviour
to express _substituted success_, you have two options:

```ts
// Option A — accept the cancelled styling:
onApprovalRequired={async ({ name }) =>
  name === 'simulate_only' ? 'Operation simulated.' : INLINE_APPROVAL
}

// Option B — actually run the tool (and have your tool implementation
// return the canned result internally):
onApprovalRequired={async ({ name }) =>
  name === 'simulate_only' ? true : INLINE_APPROVAL
}
```

We chose to drop the "substituted success" status because it conflated
"tool ran and succeeded" with "tool was bypassed and a result was substituted"
in the rendered timeline — surprising for users auditing what the agent
actually did. Cancelled-with-result is the honest reading.

---

## 5. Sub-agent approvals (issue #128 fix)

### Before — broken

```tsx
const runner = new AgentRunner(adapter, registry);
registry.register(
  createAgentTool(runner, CODER, {
    name: 'delegate',
    description: 'Hand off to the coder.',
    parameters: {
      /* ... */
    },
    scope: 'write',
    buildInput: (a) => a.task,
  }),
);

<AgentProvider runner={runner} agent={PLANNER}>
  <ConversationPanel />
</AgentProvider>;
```

If `CODER` calls a tool with `requiresApproval: true`, the approval
_silently bypassed_ — the tool executed without the user being asked.

### After — fixed automatically

The exact same code now correctly fires `onApprovalRequired` for the
sub-agent's flagged tool calls. The handler attached by `<AgentProvider>` to
the parent's `Conversation` propagates to the child run via
`ToolContext.approvalHandler`.

No code change. Bump the version and confirm with your existing test suite
(or the test we landed in `approval.test.tsx` covering this exact flow).

---

## 6. Sub-agents on independent runners

The architecture also unlocks a previously-broken case: sub-agents whose
runner is fully independent of the parent's (different adapter, different
registry, different toolset).

```tsx
// Parent uses URP-backed remote inference; child uses on-device Gemini Nano.
const parentRunner = new AgentRunner(urpAdapter, parentRegistry);
const childRunner = new AgentRunner(nanoAdapter, childRegistry);

parentRegistry.register(
  createAgentTool(childRunner, CHILD, {
    name: 'private_classifier',
    description: 'Classifies sensitive input on-device.',
    parameters: {
      /* ... */
    },
    scope: 'read',
    buildInput: (a) => a.text,
  }),
);

<AgentProvider runner={parentRunner} agent={PARENT}>
  <ConversationPanel />
</AgentProvider>;
```

Approvals on `childRunner`'s tools surface to the same
`<AgentProvider>` UI as the parent's, with no additional wiring — the
handler attached on the parent's `Conversation` propagates through
`ToolContext`.

If you want the child to enforce its own policy _instead_ of inheriting:

```ts
childRunner.approvalHandler = {
  async requestApproval({ name }) {
    return isAutoApprovedInChild(name)
      ? ApprovalResponse.approve()
      : ApprovalResponse.reject('Not allowed in classifier sandbox.');
  },
};
```

When `childRunner.approvalHandler` is set, `createAgentTool` does _not_
inherit from `ToolContext` — the explicit child policy wins.

---

## 7. Replacing `withApprovalProxy`

`withApprovalProxy`, `ApprovalProxyTool`, and `ApprovalProxyHooks` are
removed from `@mast-ai/react-ui`. They were internal but reachable for
anyone building a custom provider. The replacement is the new
`runner.conversation(agent, { approvalHandler })` API plus a hand-rolled
`ApprovalHandler`:

### Before

```ts
import { withApprovalProxy } from '@mast-ai/react-ui';

const wrapped = withApprovalProxy(
  runner.registry,
  () => myCallback,
  () => myOverride,
  hooks,
);
const wrappedRunner = new AgentRunner(runner.adapter, wrapped);
const conversation = wrappedRunner.conversation(agent);
```

### After

```ts
import { type ApprovalHandler, ApprovalResponse, computeNeedsApproval } from '@mast-ai/react-ui';

const approvalHandler: ApprovalHandler = {
  async requestApproval({ name, args }) {
    const def = runner.registry.getTool(name)?.definition();
    if (!def || !computeNeedsApproval(def, myOverride)) {
      return ApprovalResponse.approve();
    }
    const decision = await myCallback({ name, args });
    if (decision === true) return ApprovalResponse.approve();
    if (decision === false) return ApprovalResponse.reject();
    return ApprovalResponse.reject(decision); // string
  },
};

const conversation = runner.conversation(agent, { approvalHandler });
```

The user's `runner` is used directly — no more shadow runner. The handler
is a closure over whatever React state your provider tracks (callback ref,
override list, awaiting setters, inline queue).

---

## 8. Verification checklist

After upgrading, confirm:

- [ ] `npm install` resolves the new versions across both packages.
- [ ] Existing approval flows continue to work — flagged tools still pause
      for confirmation, the inline queue still fills correctly.
- [ ] If your app uses `createAgentTool`, a sub-agent calling a flagged tool
      now triggers the approval UI (it didn't before).
- [ ] Any `respondWith(text)` call sites have been renamed to `reject(text)`.
- [ ] If your `onApprovalRequired` returns a string, the cancelled styling
      on the rendered tool entry is what you want (or fix per §4).

---

## 9. Rolling back

If you need to revert, pin both packages to the previous release together:

```json
{
  "dependencies": {
    "@mast-ai/core": "0.6.0",
    "@mast-ai/react-ui": "0.6.0"
  }
}
```

Mixing major-feature mismatched versions across `@mast-ai/*` is unsupported —
the lockstep release policy means consumers always upgrade or downgrade
the entire family together.

---

## 10. Where to file issues

Bugs in the migration: open an issue on GitHub with the `sub-agents` label
and a minimal reproduction. The sub-agents PRD/SPEC/PLAN documents are
archived under `docs/archive/sub-agents/` after the rollout — refer to them
for the rationale behind the design choices in this guide.
