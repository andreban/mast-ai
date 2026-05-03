// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

export type { ConversationEntry, ToolEventEntry, ToolCallStatus, IconMap } from './types.js';
export { useAgentStream } from './hooks/useAgentStream.js';
export type { UseAgentStreamOptions, UseAgentStreamReturn } from './hooks/useAgentStream.js';
export { AgentProvider, useAgent } from './context.js';
export type { AgentProviderProps, UseAgentReturn } from './context.js';
export { INLINE_APPROVAL } from './approval.js';
export type { OnApprovalRequired, PendingApproval } from './approval.js';
export { InlineApproval } from './components/InlineApproval.js';
export type { InlineApprovalProps } from './components/InlineApproval.js';
export { ThinkingBlock } from './components/ThinkingBlock.js';
export type { ThinkingBlockProps } from './components/ThinkingBlock.js';
export { ToolCallBlock } from './components/ToolCallBlock.js';
export type { ToolCallBlockProps } from './components/ToolCallBlock.js';
export { UserMessage } from './components/UserMessage.js';
export type { UserMessageProps } from './components/UserMessage.js';
export { AssistantMessage } from './components/AssistantMessage.js';
export type { AssistantMessageProps, RenderApproval } from './components/AssistantMessage.js';
export { ChatInput } from './components/ChatInput.js';
export type { ChatInputProps } from './components/ChatInput.js';
export { MessageItem } from './components/MessageItem.js';
export type { MessageItemProps } from './components/MessageItem.js';
export { MessageList } from './components/MessageList.js';
export type { MessageListProps } from './components/MessageList.js';
export { ConversationPanel } from './components/ConversationPanel.js';
export type { ConversationPanelProps } from './components/ConversationPanel.js';
export { useMentions } from './mentions/useMentions.js';
export type { UseMentionsReturn } from './mentions/useMentions.js';
export {
  buildInlineMentionPrompt,
  extractMentionQuery,
  removeMentionTrigger,
} from './mentions/utils.js';
export type { MentionItem, MentionSegment, MentionsConfig } from './mentions/types.js';
