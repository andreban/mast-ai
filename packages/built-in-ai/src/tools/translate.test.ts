// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi, beforeEach } from "vitest";
import { TranslateTool } from "./translate.js";
import { ToolRegistry } from "@mast-ai/core";
import type { TranslatorSession } from "../types.js";

function makeSession(overrides: Partial<TranslatorSession> = {}): TranslatorSession {
  return {
    translate: vi.fn().mockResolvedValue("translated text"),
    destroy: vi.fn(),
    ...overrides,
  };
}

const mockCreate = vi.fn();
const mockAvailability = vi.fn();

vi.stubGlobal("Translator", {
  create: mockCreate,
  availability: mockAvailability,
});

describe("TranslateTool", () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAvailability.mockResolvedValue("readily");
    mockCreate.mockResolvedValue(makeSession());
    registry = new ToolRegistry();
  });

  describe("addToRegistry", () => {
    it("rejects with AdapterError when Translator global is absent", async () => {
      vi.stubGlobal("Translator", undefined);

      await expect(TranslateTool.addToRegistry(registry)).rejects.toThrow(
        "not supported in this browser",
      );
      expect(registry.getTools()).toHaveLength(0);

      vi.stubGlobal("Translator", { create: mockCreate, availability: mockAvailability });
    });

    it("registers the tool immediately without creating a session", async () => {
      await TranslateTool.addToRegistry(registry);

      expect(registry.getTools()).toHaveLength(1);
      expect(registry.getTools()[0].name).toBe("translate");
      expect(mockCreate).not.toHaveBeenCalled();
    });
  });

  describe("call()", () => {
    it("rejects with AdapterError when Translator global is absent", async () => {
      await TranslateTool.addToRegistry(registry);
      const tool = registry.getTool("translate")!;

      vi.stubGlobal("Translator", undefined);
      await expect(
        tool.call({ text: "hello", sourceLanguage: "en", targetLanguage: "fr" }, {}),
      ).rejects.toThrow("not supported in this browser");

      vi.stubGlobal("Translator", { create: mockCreate, availability: mockAvailability });
    });

    it("rejects with AdapterError when the language pair is unavailable", async () => {
      mockAvailability.mockResolvedValue("unavailable");

      await TranslateTool.addToRegistry(registry);
      const tool = registry.getTool("translate")!;

      await expect(
        tool.call({ text: "hello", sourceLanguage: "en", targetLanguage: "xx" }, {}),
      ).rejects.toThrow("Translation from en to xx is not available on this device.");
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it("resolves with translated string when pair is readily available", async () => {
      const session = makeSession({ translate: vi.fn().mockResolvedValue("bonjour") });
      mockCreate.mockResolvedValue(session);

      await TranslateTool.addToRegistry(registry);
      const tool = registry.getTool("translate")!;

      const result = await tool.call(
        { text: "hello", sourceLanguage: "en", targetLanguage: "fr" },
        {},
      );
      expect(result).toBe("bonjour");
    });

    it("creates a session with monitor when pair is after-download", async () => {
      mockAvailability.mockResolvedValue("after-download");
      const onDownloadProgress = vi.fn();

      await TranslateTool.addToRegistry(registry, { onDownloadProgress });
      const tool = registry.getTool("translate")!;

      await tool.call({ text: "hello", sourceLanguage: "en", targetLanguage: "fr" }, {});

      const createOpts = mockCreate.mock.calls[0][0];
      expect(typeof createOpts.monitor).toBe("function");
    });

    it("fires onDownloadProgress callback when downloadprogress event fires", async () => {
      mockAvailability.mockResolvedValue("after-download");

      let capturedMonitor: EventTarget | null = null;
      mockCreate.mockImplementation(
        async (opts: { monitor?: (m: EventTarget) => void }) => {
          if (opts?.monitor) {
            const et = new EventTarget();
            opts.monitor(et);
            capturedMonitor = et;
          }
          return makeSession();
        },
      );

      const onDownloadProgress = vi.fn();
      await TranslateTool.addToRegistry(registry, { onDownloadProgress });
      const tool = registry.getTool("translate")!;

      await tool.call({ text: "hello", sourceLanguage: "en", targetLanguage: "fr" }, {});

      const evt = Object.assign(new Event("downloadprogress"), { loaded: 50, total: 100 });
      capturedMonitor!.dispatchEvent(evt);

      expect(onDownloadProgress).toHaveBeenCalledWith({
        loaded: 50,
        total: 100,
        sourceLanguage: "en",
        targetLanguage: "fr",
      });
    });

    it("reuses a cached session for the same language pair", async () => {
      await TranslateTool.addToRegistry(registry);
      const tool = registry.getTool("translate")!;

      await tool.call({ text: "hello", sourceLanguage: "en", targetLanguage: "fr" }, {});
      await tool.call({ text: "world", sourceLanguage: "en", targetLanguage: "fr" }, {});

      expect(mockCreate).toHaveBeenCalledTimes(1);
    });

    it("creates separate sessions for different language pairs", async () => {
      await TranslateTool.addToRegistry(registry);
      const tool = registry.getTool("translate")!;

      await tool.call({ text: "hello", sourceLanguage: "en", targetLanguage: "fr" }, {});
      await tool.call({ text: "hello", sourceLanguage: "en", targetLanguage: "ja" }, {});

      expect(mockCreate).toHaveBeenCalledTimes(2);
      expect(mockCreate.mock.calls[0][0]).toMatchObject({
        sourceLanguage: "en",
        targetLanguage: "fr",
      });
      expect(mockCreate.mock.calls[1][0]).toMatchObject({
        sourceLanguage: "en",
        targetLanguage: "ja",
      });
    });

    it("forwards context.signal to create() and translate()", async () => {
      const session = makeSession();
      mockCreate.mockResolvedValue(session);

      await TranslateTool.addToRegistry(registry);
      const tool = registry.getTool("translate")!;

      const controller = new AbortController();
      await tool.call(
        { text: "hello", sourceLanguage: "en", targetLanguage: "fr" },
        { signal: controller.signal },
      );

      expect(mockCreate.mock.calls[0][0]).toMatchObject({ signal: controller.signal });
      expect(session.translate).toHaveBeenCalledWith(
        "hello",
        expect.objectContaining({ signal: controller.signal }),
      );
    });

    it("does not cache session when create() is aborted", async () => {
      const controller = new AbortController();
      controller.abort();

      mockCreate.mockRejectedValue(new DOMException("Aborted", "AbortError"));

      await TranslateTool.addToRegistry(registry);
      const tool = registry.getTool("translate")!;

      await expect(
        tool.call(
          { text: "hello", sourceLanguage: "en", targetLanguage: "fr" },
          { signal: controller.signal },
        ),
      ).rejects.toThrow();

      // Second call should retry create()
      mockCreate.mockResolvedValue(makeSession());
      await tool.call({ text: "hello", sourceLanguage: "en", targetLanguage: "fr" }, {});
      expect(mockCreate).toHaveBeenCalledTimes(2);
    });

    it("propagates error thrown by translate()", async () => {
      const session = makeSession({
        translate: vi.fn().mockRejectedValue(new Error("translate failed")),
      });
      mockCreate.mockResolvedValue(session);

      await TranslateTool.addToRegistry(registry);
      const tool = registry.getTool("translate")!;

      await expect(
        tool.call({ text: "hello", sourceLanguage: "en", targetLanguage: "fr" }, {}),
      ).rejects.toThrow("translate failed");
    });
  });
});
