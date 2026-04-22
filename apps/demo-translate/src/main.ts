// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { TranslateTool } from '@mast-ai/built-in-ai';

const tool = new TranslateTool({
  onDownloadProgress: ({ loaded, total, sourceLanguage, targetLanguage }) => {
    const pct = total > 0 ? Math.round((loaded / total) * 100) : 0;
    setProgress(`Downloading ${sourceLanguage}→${targetLanguage} model… ${pct}%`);
  },
});

// ── DOM refs ──────────────────────────────────────────────────────────────

const form       = document.getElementById('translate-form') as HTMLFormElement;
const sourceLang = document.getElementById('source-lang')    as HTMLSelectElement;
const targetLang = document.getElementById('target-lang')    as HTMLSelectElement;
const swapBtn    = document.getElementById('swap-btn')       as HTMLButtonElement;
const sourceText = document.getElementById('source-text')    as HTMLTextAreaElement;
const result     = document.getElementById('result')         as HTMLDivElement;
const statusEl   = document.getElementById('api-status')     as HTMLDivElement;
const progressEl = document.getElementById('progress-msg')   as HTMLSpanElement;
const errorEl    = document.getElementById('error-msg')      as HTMLDivElement;
const submitBtn  = document.getElementById('translate-btn')  as HTMLButtonElement;

// ── Availability ──────────────────────────────────────────────────────────

function isGlobal(name: string) {
  return typeof (globalThis as Record<string, unknown>)[name] !== 'undefined';
}

if (isGlobal('Translator')) {
  statusEl.textContent = 'Translator API available';
  statusEl.className = 'status available';
} else {
  statusEl.textContent = 'Translator API not supported in this browser';
  statusEl.className = 'status unavailable';
  submitBtn.disabled = true;
}

// ── Helpers ───────────────────────────────────────────────────────────────

function setProgress(msg: string) {
  progressEl.textContent = msg;
  progressEl.classList.remove('hidden');
}

function clearProgress() {
  progressEl.classList.add('hidden');
  progressEl.textContent = '';
}

function showError(msg: string) {
  errorEl.textContent = msg;
  errorEl.classList.remove('hidden');
}

function clearError() {
  errorEl.classList.add('hidden');
  errorEl.textContent = '';
}

// ── Swap button ───────────────────────────────────────────────────────────

swapBtn.addEventListener('click', () => {
  const tmp = sourceLang.value;
  sourceLang.value = targetLang.value;
  targetLang.value = tmp;
});

// ── Form submit ───────────────────────────────────────────────────────────

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = sourceText.value.trim();
  if (!text) return;

  clearError();
  clearProgress();
  result.textContent = '';
  submitBtn.disabled = true;

  try {
    const translation = await tool.call(
      { text, sourceLanguage: sourceLang.value, targetLanguage: targetLang.value },
      {},
    );
    result.textContent = String(translation);
  } catch (err) {
    showError(err instanceof Error ? err.message : String(err));
  } finally {
    clearProgress();
    submitBtn.disabled = false;
  }
});
