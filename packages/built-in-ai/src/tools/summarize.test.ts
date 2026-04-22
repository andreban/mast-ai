// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi, beforeEach } from "vitest";
import { SummarizeTool } from "./summarize.js";
import { ToolRegistry } from "@mast-ai/core";
import type { SummarizerSession } from "../types.js";

function makeSession(overrides: Partial<SummarizerSession> = {}): SummarizerSession {
  return {
    summarize: vi.fn().mockResolvedValue("summary text"),
    summarizeStreaming: vi.fn(),
    destroy: vi.fn(),
    ...overrides,
  };
}

// Drain all pending microtasks so the background registration completes.
const flush = () => Promise.resolve();

const mockCreate = vi.fn();
const mockAvailability = vi.fn();

vi.stubGlobal("Summarizer", {
  create: mockCreate,
  availability: mockAvailability,
});

describe("SummarizeTool", () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAvailability.mockResolvedValue("readily");
    mockCreate.mockResolvedValue(makeSession());
    registry = new ToolRegistry();
  });

  describe("addToRegistry", () => {
    it("rejects with AdapterError when Summarizer global is absent", async () => {
      vi.stubGlobal("Summarizer", undefined);

      await expect(SummarizeTool.addToRegistry(registry)).rejects.toThrow(
        "not supported in this browser",
      );
      expect(registry.definitions()).toHaveLength(0);

      vi.stubGlobal("Summarizer", { create: mockCreate, availability: mockAvailability });
    });

    it("resolves and registers tool in background when readily available", async () => {
      await SummarizeTool.addToRegistry(registry);
      await flush();

      expect(mockCreate).toHaveBeenCalled();
      expect(registry.definitions()).toHaveLength(1);
      expect(registry.definitions()[0].name).toBe("summarize");
    });

    it("resolves and registers tool in background when after-download", async () => {
      mockAvailability.mockResolvedValue("after-download");
      const onDownloadProgress = vi.fn();

      await SummarizeTool.addToRegistry(registry, { onDownloadProgress });
      await flush();

      const createOpts = mockCreate.mock.calls[0][0];
      expect(typeof createOpts.monitor).toBe("function");
      expect(registry.definitions()).toHaveLength(1);
    });

    it("resolves and registers tool in background when downloading", async () => {
      mockAvailability.mockResolvedValue("downloading");

      await SummarizeTool.addToRegistry(registry);
      await flush();

      expect(mockCreate).toHaveBeenCalled();
      expect(registry.definitions()).toHaveLength(1);
    });

    it("rejects with AdapterError when unavailable", async () => {
      mockAvailability.mockResolvedValue("unavailable");

      await expect(SummarizeTool.addToRegistry(registry)).rejects.toThrow(
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
      await SummarizeTool.addToRegistry(registry, { onDownloadProgress });

      // Summarizer.create() was called synchronously before addToRegistry resolved,
      // so capturedMonitor is already set — no flush needed here.
      const evt = Object.assign(new Event("downloadprogress"), { loaded: 50, total: 100 });
      capturedMonitor!.dispatchEvent(evt);

      expect(onDownloadProgress).toHaveBeenCalledWith({ loaded: 50, total: 100 });
    });
  });

  describe("call()", () => {
    it("rejects with AdapterError when Summarizer global is absent", async () => {
      vi.stubGlobal("Summarizer", undefined);

      const tool = new SummarizeTool();
      await expect(tool.call({ text: "hello" }, {})).rejects.toThrow(
        "not supported in this browser",
      );

      vi.stubGlobal("Summarizer", { create: mockCreate, availability: mockAvailability });
    });

    it("resolves with the summary string", async () => {
      await SummarizeTool.addToRegistry(registry);
      await flush();
      const tool = registry.get("summarize")!;

      const result = await tool.call({ text: "long text" }, {});
      expect(result).toBe("summary text");
    });

    it("reuses the cached instance when options match", async () => {
      await SummarizeTool.addToRegistry(registry);
      await flush();
      const tool = registry.get("summarize")!;

      await tool.call({ text: "first" }, {});
      await tool.call({ text: "second" }, {});

      expect(mockCreate).toHaveBeenCalledTimes(1);
    });

    it("destroys old instance and creates new one when options differ", async () => {
      const session1 = makeSession();
      const session2 = makeSession();
      mockCreate.mockResolvedValueOnce(session1).mockResolvedValueOnce(session2);

      await SummarizeTool.addToRegistry(registry);
      await flush();
      const tool = registry.get("summarize")!;

      await tool.call({ text: "first" }, {});
      await tool.call({ text: "second", type: "tldr" }, {});

      expect(session1.destroy).toHaveBeenCalled();
      expect(mockCreate).toHaveBeenCalledTimes(2);
    });

    it("forwards context.signal to summarize()", async () => {
      const session = makeSession();
      mockCreate.mockResolvedValue(session);

      await SummarizeTool.addToRegistry(registry);
      await flush();
      const tool = registry.get("summarize")!;

      const controller = new AbortController();
      await tool.call({ text: "text" }, { signal: controller.signal });

      expect(session.summarize).toHaveBeenCalledWith(
        "text",
        expect.objectContaining({ signal: controller.signal }),
      );
    });

    it("propagates error thrown by summarize()", async () => {
      const session = makeSession({
        summarize: vi.fn().mockRejectedValue(new Error("summarize failed")),
      });
      mockCreate.mockResolvedValue(session);

      await SummarizeTool.addToRegistry(registry);
      await flush();
      const tool = registry.get("summarize")!;

      await expect(tool.call({ text: "text" }, {})).rejects.toThrow("summarize failed");
    });
  });
});
