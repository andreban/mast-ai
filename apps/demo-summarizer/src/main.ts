// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { VERSION, ToolRegistry } from '@mast-ai/core';
import { SummarizeTool } from '@mast-ai/built-in-ai';
import type { SummarizeArgs } from '@mast-ai/built-in-ai';

document.querySelector<HTMLElement>('#version')!.textContent = `v${VERSION}`;

// --- Elements ---
const availabilityBadge = document.querySelector<HTMLElement>('#availability-badge')!;
const availabilityNote = document.querySelector<HTMLElement>('#availability-note')!;
const summarizeButton = document.querySelector<HTMLButtonElement>('#summarize-button')!;
const stopButton = document.querySelector<HTMLButtonElement>('#stop-button')!;
const inputText = document.querySelector<HTMLTextAreaElement>('#input-text')!;
const outputBox = document.querySelector<HTMLElement>('#output-box')!;
const statusIndicator = document.querySelector<HTMLElement>('#status-indicator')!;
const optType = document.querySelector<HTMLSelectElement>('#opt-type')!;
const optFormat = document.querySelector<HTMLSelectElement>('#opt-format')!;
const optLength = document.querySelector<HTMLSelectElement>('#opt-length')!;
const optContext = document.querySelector<HTMLInputElement>('#opt-context')!;

// --- Availability + Registration ---
const registry = new ToolRegistry();
let registered = false;

function onReady() {
  registered = true;
  availabilityBadge.className = 'availability-badge readily';
  availabilityBadge.textContent = 'ready';
  availabilityNote.textContent = 'The model is downloaded and ready.';
  summarizeButton.disabled = false;
}

function onUnavailable(err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  const key = msg.includes('not supported') ? 'no-api' : 'unavailable';
  const notes: Record<string, string> = {
    unavailable: 'Summarizer API is not available on this device.',
    'no-api': 'The Summarizer API is not supported in this browser.',
  };
  availabilityBadge.className = `availability-badge ${key}`;
  availabilityBadge.textContent = key;
  availabilityNote.textContent = notes[key] ?? '';
}

async function startRegistration() {
  if (registered) return;

  availabilityBadge.className = 'availability-badge checking';
  availabilityBadge.textContent = 'Checking…';
  availabilityNote.textContent = '';
  summarizeButton.disabled = true;

  try {
    // addToRegistry resolves once availability is confirmed. The tool is added
    // to the registry in the background (after any model download completes).
    await SummarizeTool.addToRegistry(registry, {
      onDownloadProgress: ({ loaded, total }: { loaded: number; total: number }) => {
        const pct = total > 0 ? Math.round((loaded / total) * 100) : 0;
        availabilityBadge.className = 'availability-badge downloading';
        availabilityBadge.textContent = `Downloading ${pct}%`;
        availabilityNote.textContent = `${loaded.toLocaleString()} / ${total.toLocaleString()} bytes`;
      },
    });
    // API is available — show downloading state while background session is created.
    availabilityBadge.className = 'availability-badge downloading';
    availabilityBadge.textContent = 'Loading…';
    availabilityNote.textContent = 'Preparing the on-device model…';
    // Poll until the tool appears in the registry (background registration complete).
    await waitForTool();
    onReady();
  } catch (err) {
    onUnavailable(err);
  }
}

function waitForTool(): Promise<void> {
  return new Promise((resolve) => {
    function check() {
      if (registry.get('summarize')) {
        resolve();
      } else {
        setTimeout(check, 50);
      }
    }
    check();
  });
}

document.querySelector('#refresh-button')!.addEventListener('click', startRegistration);
startRegistration();

// --- Summarize ---
let currentController: AbortController | null = null;

function setOutput(text: string, isError = false) {
  outputBox.innerHTML = '';
  outputBox.className = isError ? 'output-box error' : 'output-box';
  outputBox.textContent = text;
}

async function handleSummarize() {
  if (currentController) return;
  const text = inputText.value.trim();
  if (!text) return;

  const tool = registry.get('summarize');
  if (!tool) return;

  const args: SummarizeArgs = {
    text,
    type: (optType.value || undefined) as SummarizeArgs['type'],
    format: (optFormat.value || undefined) as SummarizeArgs['format'],
    length: (optLength.value || undefined) as SummarizeArgs['length'],
    context: optContext.value.trim() || undefined,
  };

  const controller = new AbortController();
  currentController = controller;

  summarizeButton.disabled = true;
  stopButton.hidden = false;
  statusIndicator.textContent = 'Summarizing…';
  statusIndicator.className = 'status-indicator running';
  outputBox.innerHTML = '<span class="placeholder">Working…</span>';
  outputBox.className = 'output-box';

  try {
    const result = await tool.call(args, { signal: controller.signal }) as string;
    setOutput(result);
  } catch (err) {
    if (!controller.signal.aborted) {
      setOutput(err instanceof Error ? err.message : String(err), true);
    }
  } finally {
    currentController = null;
    summarizeButton.disabled = false;
    stopButton.hidden = true;
    statusIndicator.textContent = 'Idle';
    statusIndicator.className = 'status-indicator';
  }
}

summarizeButton.addEventListener('click', handleSummarize);
stopButton.addEventListener('click', () => currentController?.abort());
