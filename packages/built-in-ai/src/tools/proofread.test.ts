// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi, beforeEach } from "vitest";
import { ProofreadTool } from "./proofread.js";
import { ToolRegistry } from "@mast-ai/core";
import type { ProofreaderSession, ProofreadResult } from "../types.js";

const RESULT: ProofreadResult = {
  correctedInput: "the cat",
  corrections: [{ correction: "the", startIndex: 0, endIndex: 3 }],
};

function makeSession(overrides: Partial<ProofreaderSession> = {}): ProofreaderSession {
  return {
    proofread: vi.fn().mockResolvedValue(RESULT),
    destroy: vi.fn(),
    ...overrides,
  };
}

const mockCreate = vi.fn();
const mockAvailability = vi.fn();

vi.stubGlobal("Proofreader", {
  create: mockCreate,
  availability: mockAvailability,
});

describe("ProofreadTool", () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAvailability.mockResolvedValue("available");
    mockCreate.mockResolvedValue(makeSession());
    registry = new ToolRegistry();
  });

  describe("addToRegistry", () => {
    it("rejects with AdapterError when Proofreader global is absent", async () => {
      vi.stubGlobal("Proofreader", undefined);

      await expect(ProofreadTool.addToRegistry(registry)).rejects.toThrow(
        "not supported in this browser",
      );
      expect(registry.getTools()).toHaveLength(0);

      vi.stubGlobal("Proofreader", { create: mockCreate, availability: mockAvailability });
    });

    it("rejects with AdapterError when availability is unavailable", async () => {
      mockAvailability.mockResolvedValue("unavailable");

      await expect(ProofreadTool.addToRegistry(registry)).rejects.toThrow(
        "not available on this device",
      );
      expect(registry.getTools()).toHaveLength(0);
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it("creates session eagerly and registers when availability is available", async () => {
      await ProofreadTool.addToRegistry(registry);

      expect(mockCreate).toHaveBeenCalledTimes(1);
      expect(registry.getTools()).toHaveLength(1);
      expect(registry.getTools()[0].name).toBe("proofread");
    });

    it("registers without creating a session when availability is downloadable", async () => {
      mockAvailability.mockResolvedValue("downloadable");

      await ProofreadTool.addToRegistry(registry);

      expect(mockCreate).not.toHaveBeenCalled();
      expect(registry.getTools()).toHaveLength(1);
    });

    it("registers without creating a session when availability is downloading", async () => {
      mockAvailability.mockResolvedValue("downloading");

      await ProofreadTool.addToRegistry(registry);

      expect(mockCreate).not.toHaveBeenCalled();
      expect(registry.getTools()).toHaveLength(1);
    });
  });

  describe("call() — session created eagerly (available)", () => {
    it("rejects with AdapterError when Proofreader global is absent", async () => {
      await ProofreadTool.addToRegistry(registry);
      const tool = registry.getTool("proofread")!;

      vi.stubGlobal("Proofreader", undefined);
      await expect(tool.call({ text: "teh cat" }, {})).rejects.toThrow(
        "not supported in this browser",
      );

      vi.stubGlobal("Proofreader", { create: mockCreate, availability: mockAvailability });
    });

    it("returns ProofreadResult from session.proofread", async () => {
      await ProofreadTool.addToRegistry(registry);
      const tool = registry.getTool("proofread")!;

      const result = await tool.call({ text: "teh cat" }, {});
      expect(result).toEqual(RESULT);
    });

    it("returns empty corrections when no issues found", async () => {
      const emptyResult: ProofreadResult = { correctedInput: "the cat", corrections: [] };
      mockCreate.mockResolvedValue(makeSession({ proofread: vi.fn().mockResolvedValue(emptyResult) }));

      await ProofreadTool.addToRegistry(registry);
      const tool = registry.getTool("proofread")!;

      const result = await tool.call({ text: "the cat" }, {});
      expect(result).toEqual(emptyResult);
    });

    it("forwards context.signal to proofread()", async () => {
      const session = makeSession();
      mockCreate.mockResolvedValue(session);

      await ProofreadTool.addToRegistry(registry);
      const tool = registry.getTool("proofread")!;

      const controller = new AbortController();
      await tool.call({ text: "teh cat" }, { signal: controller.signal });

      expect(session.proofread).toHaveBeenCalledWith(
        "teh cat",
        expect.objectContaining({ signal: controller.signal }),
      );
    });

    it("propagates error thrown by proofread()", async () => {
      const session = makeSession({
        proofread: vi.fn().mockRejectedValue(new Error("proofread failed")),
      });
      mockCreate.mockResolvedValue(session);

      await ProofreadTool.addToRegistry(registry);
      const tool = registry.getTool("proofread")!;

      await expect(tool.call({ text: "teh cat" }, {})).rejects.toThrow("proofread failed");
    });

    it("reuses the same session across multiple calls", async () => {
      const session = makeSession();
      mockCreate.mockResolvedValue(session);

      await ProofreadTool.addToRegistry(registry);
      const tool = registry.getTool("proofread")!;

      await tool.call({ text: "teh cat" }, {});
      await tool.call({ text: "speling eror" }, {});

      expect(mockCreate).toHaveBeenCalledTimes(1);
      expect(session.proofread).toHaveBeenCalledTimes(2);
    });
  });

  describe("call() — session created lazily (downloadable/downloading)", () => {
    it("creates session on first call and passes monitor", async () => {
      mockAvailability.mockResolvedValue("downloadable");
      const onDownloadProgress = vi.fn();

      await ProofreadTool.addToRegistry(registry, { onDownloadProgress });
      expect(mockCreate).not.toHaveBeenCalled();

      const tool = registry.getTool("proofread")!;
      await tool.call({ text: "teh cat" }, {});

      expect(mockCreate).toHaveBeenCalledTimes(1);
      const createOpts = mockCreate.mock.calls[0][0];
      expect(typeof createOpts.monitor).toBe("function");
    });

    it("fires onDownloadProgress callback when downloadprogress event fires", async () => {
      mockAvailability.mockResolvedValue("downloadable");

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
      await ProofreadTool.addToRegistry(registry, { onDownloadProgress });

      const tool = registry.getTool("proofread")!;
      await tool.call({ text: "teh cat" }, {});

      const evt = Object.assign(new Event("downloadprogress"), { loaded: 50, total: 100 });
      capturedMonitor!.dispatchEvent(evt);

      expect(onDownloadProgress).toHaveBeenCalledWith({ loaded: 50, total: 100 });
    });

    it("reuses session created on first call for subsequent calls", async () => {
      mockAvailability.mockResolvedValue("downloadable");
      const session = makeSession();
      mockCreate.mockResolvedValue(session);

      await ProofreadTool.addToRegistry(registry);
      const tool = registry.getTool("proofread")!;

      await tool.call({ text: "teh cat" }, {});
      await tool.call({ text: "speling eror" }, {});

      expect(mockCreate).toHaveBeenCalledTimes(1);
      expect(session.proofread).toHaveBeenCalledTimes(2);
    });
  });
});
