// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { createContext } from 'react';
import type { ReactNode } from 'react';

import type { ToolEventEntry } from '../types.js';

/**
 * Computes the header label for a {@link ToolEventEntry}. Returning `undefined`
 * (or `null`) lets the consuming `<ToolCallBlock>` fall back to `entry.name`,
 * which is useful for selectively overriding only a subset of tool names.
 */
export type GetToolLabel = (entry: ToolEventEntry) => ReactNode;

/**
 * Context written by `<AssistantMessage getToolLabel>` (and parents that
 * forward the prop) and read by `<ToolCallBlock>` to resolve its header label.
 *
 * Resolution order inside `<ToolCallBlock>`:
 *
 * 1. The explicit `label` prop, if provided.
 * 2. The value returned by this context's `getToolLabel`, if defined and the
 *    return value is not `null`/`undefined`.
 * 3. `entry.name`.
 */
export const ToolLabelContext = createContext<GetToolLabel | undefined>(undefined);

/**
 * Renders a single tool event, deciding whether to show the inline approval
 * card or a regular `<ToolCallBlock>`. The same closure that
 * `<AssistantMessage>` builds for top-level entries; published via context so
 * `<ToolCallBlock>` can use it for entries inside `nestedContentBlocks` and the
 * approval-aware branch is reachable at every nesting depth.
 *
 * `<ToolCallBlock>` falls back to a bare recursive `<ToolCallBlock>` when no
 * provider is in scope, so the component still works standalone.
 */
export const NestedToolRenderContext = createContext<
  ((entry: ToolEventEntry) => ReactNode) | undefined
>(undefined);
