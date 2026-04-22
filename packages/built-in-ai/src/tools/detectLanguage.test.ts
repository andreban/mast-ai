// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi, beforeEach } from "vitest";
import { DetectLanguageTool } from "./detectLanguage.js";
import { ToolRegistry } from "@mast-ai/core";
import type { LanguageDetectorSession } from "../types.js";

function makeSession(overrides: Partial<LanguageDetectorSession> = {}): LanguageDetectorSession {
  return {
    detect: vi.fn().mockResolvedValue([{ detectedLanguage: "en", confidence: 0.97 }]),
    destroy: vi.fn(),
    ...overrides,
  };
}

// Drain all pending microtasks so the background registration completes.
const flush = () => Promise.resolve();

const mockCreate = vi.fn();
const mockAvailability = vi.fn();

vi.stubGlobal("LanguageDetector", {
  create: mockCreate,
  availability: mockAvailability,
});

describe("DetectLanguageTool", () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAvailability.mockResolvedValue("readily");
    mockCreate.mockResolvedValue(makeSession());
    registry = new ToolRegistry();
  });

  describe("addToRegistry", () => {
    it("rejects with AdapterError when LanguageDetector global is absent", async () => {
      vi.stubGlobal("LanguageDetector", undefined);

      await expect(DetectLanguageTool.addToRegistry(registry)).rejects.toThrow(
        "not supported in this browser",
      );
      expect(registry.definitions()).toHaveLength(0);

      vi.stubGlobal("LanguageDetector", { create: mockCreate, availability: mockAvailability });
    });

    it("resolves and registers tool in background when readily available", async () => {
      await DetectLanguageTool.addToRegistry(registry);
      await flush();

      expect(mockCreate).toHaveBeenCalled();
      expect(registry.definitions()).toHaveLength(1);
      expect(registry.definitions()[0].name).toBe("detectLanguage");
    });

    it("resolves and registers tool in background when after-download", async () => {
      mockAvailability.mockResolvedValue("after-download");
      const onDownloadProgress = vi.fn();

      await DetectLanguageTool.addToRegistry(registry, { onDownloadProgress });
      await flush();

      const createOpts = mockCreate.mock.calls[0][0];
      expect(typeof createOpts.monitor).toBe("function");
      expect(registry.definitions()).toHaveLength(1);
    });

    it("resolves and registers tool in background when downloading", async () => {
      mockAvailability.mockResolvedValue("downloading");

      await DetectLanguageTool.addToRegistry(registry);
      await flush();

      expect(mockCreate).toHaveBeenCalled();
      expect(registry.definitions()).toHaveLength(1);
    });

    it("rejects with AdapterError when unavailable", async () => {
      mockAvailability.mockResolvedValue("unavailable");

      await expect(DetectLanguageTool.addToRegistry(registry)).rejects.toThrow(
        "unavailable on this device",
      );
      expect(registry.definitions()).toHaveLength(0);
    });

    it("fires onDownloadProgress callback when downloadprogress event fires", async () => {
      mockAvailability.mockResolvedValue("after-download");

      let capturedMonitor: EventTarget | null = null;
      mockCreate.mockImplementation(async (opts: { monitor?: (m: EventTarget) => void }) => {
        if (opts?.monitor) {
          const et = new EventTarget();
          opts.monitor(et);
          capturedMonitor = et;
        }
        return makeSession();
      });

      const onDownloadProgress = vi.fn();
      await DetectLanguageTool.addToRegistry(registry, { onDownloadProgress });

      const evt = Object.assign(new Event("downloadprogress"), { loaded: 50, total: 100 });
      capturedMonitor!.dispatchEvent(evt);

      expect(onDownloadProgress).toHaveBeenCalledWith({ loaded: 50, total: 100 });
    });

    it("does not register tool when background session creation fails", async () => {
      mockCreate.mockRejectedValue(new Error("creation failed"));

      await DetectLanguageTool.addToRegistry(registry);
      await flush();

      expect(registry.definitions()).toHaveLength(0);
    });
  });

  describe("call()", () => {
    it("rejects with AdapterError when LanguageDetector global is absent", async () => {
      vi.stubGlobal("LanguageDetector", undefined);

      const tool = new DetectLanguageTool();
      await expect(tool.call({ text: "hello" }, {})).rejects.toThrow(
        "not supported in this browser",
      );

      vi.stubGlobal("LanguageDetector", { create: mockCreate, availability: mockAvailability });
    });

    it("resolves with the top detection result", async () => {
      await DetectLanguageTool.addToRegistry(registry);
      await flush();
      const tool = registry.get("detectLanguage")!;

      const result = await tool.call({ text: "Hello world" }, {});
      expect(result).toEqual({ detectedLanguage: "en", confidence: 0.97 });
    });

    it("reuses the cached session across calls", async () => {
      await DetectLanguageTool.addToRegistry(registry);
      await flush();
      const tool = registry.get("detectLanguage")!;

      await tool.call({ text: "first" }, {});
      await tool.call({ text: "second" }, {});

      expect(mockCreate).toHaveBeenCalledTimes(1);
    });

    it("forwards context.signal to detect()", async () => {
      const session = makeSession();
      mockCreate.mockResolvedValue(session);

      await DetectLanguageTool.addToRegistry(registry);
      await flush();
      const tool = registry.get("detectLanguage")!;

      const controller = new AbortController();
      await tool.call({ text: "text" }, { signal: controller.signal });

      expect(session.detect).toHaveBeenCalledWith(
        "text",
        expect.objectContaining({ signal: controller.signal }),
      );
    });

    it("returns null language and zero confidence when detect returns empty array", async () => {
      const session = makeSession({ detect: vi.fn().mockResolvedValue([]) });
      mockCreate.mockResolvedValue(session);

      await DetectLanguageTool.addToRegistry(registry);
      await flush();
      const tool = registry.get("detectLanguage")!;

      const result = await tool.call({ text: "???" }, {});
      expect(result).toEqual({ detectedLanguage: null, confidence: 0 });
    });

    it("propagates error thrown by detect()", async () => {
      const session = makeSession({
        detect: vi.fn().mockRejectedValue(new Error("detect failed")),
      });
      mockCreate.mockResolvedValue(session);

      await DetectLanguageTool.addToRegistry(registry);
      await flush();
      const tool = registry.get("detectLanguage")!;

      await expect(tool.call({ text: "text" }, {})).rejects.toThrow("detect failed");
    });
  });
});
