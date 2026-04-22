// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi, beforeEach } from "vitest";
import { BuiltInAIAdapter } from "./BuiltInAIAdapter.js";
import type { LanguageModelSession } from "./types.js";

function makeSession(overrides: Partial<LanguageModelSession> = {}): LanguageModelSession {
  return {
    prompt: vi.fn().mockResolvedValue("response text"),
    promptStreaming: vi.fn().mockReturnValue(
      new ReadableStream({
        start(controller) {
          controller.enqueue("hello");
          controller.close();
        },
      }),
    ),
    contextUsage: 10,
    contextWindow: 1000,
    destroy: vi.fn(),
    addEventListener: vi.fn(),
    ...overrides,
  };
}

const mockCreate = vi.fn();
const mockAvailability = vi.fn();

vi.stubGlobal("LanguageModel", {
  create: mockCreate,
  availability: mockAvailability,
});

describe("BuiltInAIAdapter", () => {
  let adapter: BuiltInAIAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAvailability.mockResolvedValue("readily");
    mockCreate.mockResolvedValue(makeSession());
    adapter = new BuiltInAIAdapter();
  });

  describe("generate", () => {
    it("returns text response", async () => {
      const response = await adapter.generate({
        messages: [{ role: "user", content: { type: "text", text: "Hi" } }],
        tools: [],
      });

      expect(response.text).toBe("response text");
      expect(response.toolCalls).toEqual([]);
    });

    it("always returns empty toolCalls", async () => {
      const response = await adapter.generate({
        messages: [{ role: "user", content: { type: "text", text: "Hi" } }],
        tools: [{ name: "myTool", description: "does stuff", parameters: {} }],
      });

      expect(response.toolCalls).toEqual([]);
    });

    it("warns when tools are passed", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      await adapter.generate({
        messages: [{ role: "user", content: { type: "text", text: "Hi" } }],
        tools: [{ name: "t", description: "d", parameters: {} }],
      });
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("tool calling is not supported"));
    });

    it("throws AdapterError when Prompt API is not supported", async () => {
      vi.stubGlobal("LanguageModel", undefined);

      await expect(
        adapter.generate({
          messages: [{ role: "user", content: { type: "text", text: "Hi" } }],
          tools: [],
        }),
      ).rejects.toThrow("not supported in this browser");

      vi.stubGlobal("LanguageModel", { create: mockCreate, availability: mockAvailability });
    });

    it("throws AdapterError when model is unavailable", async () => {
      mockAvailability.mockResolvedValue("unavailable");

      await expect(
        adapter.generate({
          messages: [{ role: "user", content: { type: "text", text: "Hi" } }],
          tools: [],
        }),
      ).rejects.toThrow("unavailable on this device");
    });

    it("throws AdapterError when model is still downloading", async () => {
      mockAvailability.mockResolvedValue("downloading");

      await expect(
        adapter.generate({
          messages: [{ role: "user", content: { type: "text", text: "Hi" } }],
          tools: [],
        }),
      ).rejects.toThrow("downloading");
    });

    it("throws AdapterError when context window is full after session creation", async () => {
      mockCreate.mockResolvedValue(
        makeSession({ contextUsage: 1000, contextWindow: 1000 }),
      );

      await expect(
        adapter.generate({
          messages: [{ role: "user", content: { type: "text", text: "Hi" } }],
          tools: [],
        }),
      ).rejects.toThrow("context window");
    });

    it("includes system prompt in initialPrompts", async () => {
      await adapter.generate({
        system: "You are terse.",
        messages: [{ role: "user", content: { type: "text", text: "Hi" } }],
        tools: [],
      });

      const opts = mockCreate.mock.calls[0][0];
      expect(opts.initialPrompts[0]).toEqual({ role: "system", content: "You are terse." });
    });

    it("maps history messages into initialPrompts", async () => {
      await adapter.generate({
        messages: [
          { role: "user", content: { type: "text", text: "Hello" } },
          { role: "assistant", content: { type: "text", text: "Hi there" } },
          { role: "user", content: { type: "text", text: "How are you?" } },
        ],
        tools: [],
      });

      const opts = mockCreate.mock.calls[0][0];
      expect(opts.initialPrompts).toHaveLength(2);
      expect(opts.initialPrompts[0]).toEqual({ role: "user", content: "Hello" });
      expect(opts.initialPrompts[1]).toEqual({ role: "assistant", content: "Hi there" });
    });

    it("calls session.prompt with the last message text", async () => {
      const session = makeSession();
      mockCreate.mockResolvedValue(session);

      await adapter.generate({
        messages: [{ role: "user", content: { type: "text", text: "What time is it?" } }],
        tools: [],
      });

      expect(session.prompt).toHaveBeenCalledWith("What time is it?", expect.anything());
    });

    it("reuses cached session for follow-up turn", async () => {
      const session = makeSession();
      mockCreate.mockResolvedValue(session);

      await adapter.generate({
        messages: [{ role: "user", content: { type: "text", text: "Hello" } }],
        tools: [],
      });

      await adapter.generate({
        messages: [
          { role: "user", content: { type: "text", text: "Hello" } },
          { role: "assistant", content: { type: "text", text: "response text" } },
          { role: "user", content: { type: "text", text: "Follow up" } },
        ],
        tools: [],
      });

      expect(mockCreate).toHaveBeenCalledTimes(1);
      expect(session.prompt).toHaveBeenCalledTimes(2);
    });

    it("creates a new session when history diverges", async () => {
      await adapter.generate({
        messages: [{ role: "user", content: { type: "text", text: "Hello" } }],
        tools: [],
      });

      await adapter.generate({
        messages: [{ role: "user", content: { type: "text", text: "Totally different" } }],
        tools: [],
      });

      expect(mockCreate).toHaveBeenCalledTimes(2);
    });

    it("destroys the old session on cache miss", async () => {
      const session1 = makeSession();
      const session2 = makeSession();
      mockCreate.mockResolvedValueOnce(session1).mockResolvedValueOnce(session2);

      await adapter.generate({
        messages: [{ role: "user", content: { type: "text", text: "First" } }],
        tools: [],
      });

      await adapter.generate({
        messages: [{ role: "user", content: { type: "text", text: "Different" } }],
        tools: [],
      });

      expect(session1.destroy).toHaveBeenCalled();
    });
  });

  describe("generateStream", () => {
    async function collect(
      request: Parameters<BuiltInAIAdapter["generateStream"]>[0],
    ) {
      const chunks: { type: string; delta?: string }[] = [];
      for await (const chunk of adapter.generateStream(request)) {
        chunks.push(chunk as never);
      }
      return chunks;
    }

    it("yields text_delta chunks from the stream", async () => {
      const chunks = await collect({
        messages: [{ role: "user", content: { type: "text", text: "Hi" } }],
        tools: [],
      });

      expect(chunks).toEqual([{ type: "text_delta", delta: "hello" }]);
    });

    it("yields multiple chunks", async () => {
      const session = makeSession({
        promptStreaming: vi.fn().mockReturnValue(
          new ReadableStream({
            start(controller) {
              controller.enqueue("chunk1");
              controller.enqueue("chunk2");
              controller.close();
            },
          }),
        ),
      });
      mockCreate.mockResolvedValue(session);

      const chunks = await collect({
        messages: [{ role: "user", content: { type: "text", text: "Hi" } }],
        tools: [],
      });

      expect(chunks).toEqual([
        { type: "text_delta", delta: "chunk1" },
        { type: "text_delta", delta: "chunk2" },
      ]);
    });

    it("warns when tools are passed", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      await collect({
        messages: [{ role: "user", content: { type: "text", text: "Hi" } }],
        tools: [{ name: "t", description: "d", parameters: {} }],
      });
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("tool calling is not supported"));
    });
  });
});
