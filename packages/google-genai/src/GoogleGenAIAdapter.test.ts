// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, vi, beforeEach } from "vitest";
import { GoogleGenAIAdapter } from "./GoogleGenAIAdapter.js";

// Mock @google/genai
vi.mock("@google/genai", () => {
  const generateContent = vi.fn().mockResolvedValue({
    candidates: [
      {
        content: {
          parts: [{ text: "Hello from Gemini!" }],
        },
      },
    ],
    usageMetadata: {
      promptTokenCount: 10,
      candidatesTokenCount: 5,
    },
  });

  const generateContentStream = vi.fn().mockResolvedValue(
    (async function* (): AsyncGenerator<unknown> {})(),
  );

  return {
    ThinkingLevel: {
      HIGH: "HIGH",
    },
    GoogleGenAI: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
      this.models = {
        generateContent,
        generateContentStream,
      };
    }),
  };
});

describe("GoogleGenAIAdapter", () => {
  let adapter: GoogleGenAIAdapter;
  const mockUsageUpdate = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new GoogleGenAIAdapter(
      "fake-api-key",
      "gemini-3.1-flash-lite-preview",
      mockUsageUpdate,
    );
  });

  it("should generate text response", async () => {
    const response = await adapter.generate({
      messages: [{ role: "user", content: { type: "text", text: "Hi" } }],
      tools: [],
    });

    expect(response.text).toBe("Hello from Gemini!");
    expect(mockUsageUpdate).toHaveBeenCalledWith({
      promptTokenCount: 10,
      candidatesTokenCount: 5,
      totalTokenCount: 15,
    });
  });

  it("should handle tool calls", async () => {
    const { GoogleGenAI } = await import("@google/genai");
    const mockClient = new (GoogleGenAI as unknown as new () => { models: { generateContent: ReturnType<typeof vi.fn> } })();
    mockClient.models.generateContent.mockResolvedValueOnce({
      candidates: [
        {
          content: {
            parts: [
              {
                functionCall: {
                  name: "testTool",
                  args: { arg1: "val1" },
                },
              },
            ],
          },
        },
      ],
      usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 5 },
    });

    const response = await adapter.generate({
      messages: [
        { role: "user", content: { type: "text", text: "Call tool" } },
      ],
      tools: [{ name: "testTool", description: "desc", parameters: {}, scope: "read" as const }],
    });

    expect(response.toolCalls).toHaveLength(1);
    expect(response.toolCalls[0].name).toBe("testTool");
    expect(response.toolCalls[0].args).toEqual({ arg1: "val1" });
  });

  it("should forward a system instruction when provided", async () => {
    const { GoogleGenAI } = await import("@google/genai");
    const mockClient = new (GoogleGenAI as unknown as new () => { models: { generateContent: ReturnType<typeof vi.fn> } })();

    await adapter.generate({
      system: "You are terse.",
      messages: [{ role: "user", content: { type: "text", text: "Hi" } }],
      tools: [],
    });

    const call = mockClient.models.generateContent.mock.calls.at(-1)?.[0];
    expect(call.config.systemInstruction).toEqual({
      parts: [{ text: "You are terse." }],
    });
  });

  it("should omit the system instruction when not provided", async () => {
    const { GoogleGenAI } = await import("@google/genai");
    const mockClient = new (GoogleGenAI as unknown as new () => { models: { generateContent: ReturnType<typeof vi.fn> } })();

    await adapter.generate({
      messages: [{ role: "user", content: { type: "text", text: "Hi" } }],
      tools: [],
    });

    const call = mockClient.models.generateContent.mock.calls.at(-1)?.[0];
    expect(call.config.systemInstruction).toBeUndefined();
  });

  it("should not drop text when a part has both thought and text set", async () => {
    const { GoogleGenAI } = await import("@google/genai");
    const mockClient = new (GoogleGenAI as unknown as new () => { models: { generateContent: ReturnType<typeof vi.fn> } })();
    mockClient.models.generateContent.mockResolvedValueOnce({
      candidates: [
        {
          content: {
            parts: [{ thought: true, text: "Thinking... and also responding" }],
          },
        },
      ],
      usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 5 },
    });

    const response = await adapter.generate({
      messages: [{ role: "user", content: { type: "text", text: "Hi" } }],
      tools: [],
    });

    expect(response.text).toBe("Thinking... and also responding");
  });

  it("should throw when no candidate is returned from generate", async () => {
    const { GoogleGenAI } = await import("@google/genai");
    const mockClient = new (GoogleGenAI as unknown as new () => { models: { generateContent: ReturnType<typeof vi.fn> } })();
    mockClient.models.generateContent.mockResolvedValueOnce({
      candidates: [],
      usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 0 },
    });

    await expect(
      adapter.generate({
        messages: [{ role: "user", content: { type: "text", text: "Hi" } }],
        tools: [],
      }),
    ).rejects.toThrow("No candidate returned from Gemini");
  });

  describe("generateStream", () => {
    async function collectChunks(
      request: Parameters<GoogleGenAIAdapter["generateStream"]>[0],
    ) {
      const chunks: { type: string; delta?: string; toolCall?: unknown }[] = [];
      for await (const chunk of adapter.generateStream(request)) {
        chunks.push(chunk as never);
      }
      return chunks;
    }

    it("should yield thinking chunk for thought parts", async () => {
      const { GoogleGenAI } = await import("@google/genai");
      const mockClient = new (GoogleGenAI as unknown as new () => { models: { generateContentStream: ReturnType<typeof vi.fn> } })();
      mockClient.models.generateContentStream.mockResolvedValueOnce(
        (async function* () {
          yield {
            candidates: [
              { content: { parts: [{ thought: true, text: "hmm..." }] } },
            ],
            usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 2 },
          };
        })(),
      );

      const chunks = await collectChunks({
        messages: [{ role: "user", content: { type: "text", text: "Hi" } }],
        tools: [],
      });

      expect(chunks).toHaveLength(1);
      expect(chunks[0].type).toBe("thinking");
      expect(chunks[0].delta).toBe("hmm...");
    });

    it("should yield text_delta for text parts", async () => {
      const { GoogleGenAI } = await import("@google/genai");
      const mockClient = new (GoogleGenAI as unknown as new () => { models: { generateContentStream: ReturnType<typeof vi.fn> } })();
      mockClient.models.generateContentStream.mockResolvedValueOnce(
        (async function* () {
          yield {
            candidates: [
              { content: { parts: [{ text: "Hello " }, { text: "world" }] } },
            ],
            usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 5 },
          };
        })(),
      );

      const chunks = await collectChunks({
        messages: [{ role: "user", content: { type: "text", text: "Hi" } }],
        tools: [],
      });

      expect(chunks).toHaveLength(2);
      expect(chunks[0]).toEqual({ type: "text_delta", delta: "Hello " });
      expect(chunks[1]).toEqual({ type: "text_delta", delta: "world" });
    });

    it("should yield tool_call chunk for function call parts", async () => {
      const { GoogleGenAI } = await import("@google/genai");
      const mockClient = new (GoogleGenAI as unknown as new () => { models: { generateContentStream: ReturnType<typeof vi.fn> } })();
      mockClient.models.generateContentStream.mockResolvedValueOnce(
        (async function* () {
          yield {
            candidates: [
              {
                content: {
                  parts: [{ functionCall: { id: "call-1", name: "read", args: {} } }],
                },
              },
            ],
            usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 3 },
          };
        })(),
      );

      const chunks = await collectChunks({
        messages: [{ role: "user", content: { type: "text", text: "Hi" } }],
        tools: [{ name: "read", description: "reads", parameters: {}, scope: "read" as const }],
      });

      expect(chunks).toHaveLength(1);
      expect(chunks[0].type).toBe("tool_call");
      expect((chunks[0] as { type: string; toolCall: { name: string } }).toolCall.name).toBe("read");
    });

    it("should call onUsageUpdate for each chunk with usage metadata", async () => {
      const { GoogleGenAI } = await import("@google/genai");
      const mockClient = new (GoogleGenAI as unknown as new () => { models: { generateContentStream: ReturnType<typeof vi.fn> } })();
      mockClient.models.generateContentStream.mockResolvedValueOnce(
        (async function* () {
          yield {
            candidates: [{ content: { parts: [{ text: "hi" }] } }],
            usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 2 },
          };
        })(),
      );

      await collectChunks({
        messages: [{ role: "user", content: { type: "text", text: "Hi" } }],
        tools: [],
      });

      expect(mockUsageUpdate).toHaveBeenCalledWith({
        promptTokenCount: 3,
        candidatesTokenCount: 2,
        totalTokenCount: 5,
      });
    });

    it("should skip chunks with no candidates", async () => {
      const { GoogleGenAI } = await import("@google/genai");
      const mockClient = new (GoogleGenAI as unknown as new () => { models: { generateContentStream: ReturnType<typeof vi.fn> } })();
      mockClient.models.generateContentStream.mockResolvedValueOnce(
        (async function* () {
          yield { candidates: [], usageMetadata: {} };
          yield {
            candidates: [{ content: { parts: [{ text: "hello" }] } }],
            usageMetadata: {},
          };
        })(),
      );

      const chunks = await collectChunks({
        messages: [{ role: "user", content: { type: "text", text: "Hi" } }],
        tools: [],
      });

      expect(chunks).toHaveLength(1);
      expect(chunks[0].type).toBe("text_delta");
    });
  });
});
