// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { ProofreadTool } from '@mast-ai/built-in-ai';
import type { ProofreadCorrection, ProofreadResult } from '@mast-ai/built-in-ai';
import { ToolRegistry } from '@mast-ai/core';
import type { Tool } from '@mast-ai/core';

const SAMPLE_TEXT =
  `Last weak, me and my freinds went to a resturant that had recieved alot of ` +
  `positiv reviews online. When we arived, the place was completley packt with ` +
  `costumers. The waiter brung us to are table and taked our orders. The food was ` +
  `absolutley delicous, accept for the deserts wich was a bit to sweet. We spend ` +
  `alot of time chatting and did not realise it were getting late. All in all, it ` +
  `were a wonderfull evning and we definatly plan to visit agian.`;

// DOM refs
const statusBadge = document.querySelector<HTMLElement>('#status-badge')!;
const textarea = document.querySelector<HTMLTextAreaElement>('#input-text')!;
const proofreadBtn = document.querySelector<HTMLButtonElement>('#proofread-btn')!;
const sampleBtn = document.querySelector<HTMLButtonElement>('#sample-btn')!;
const resultsSection = document.querySelector<HTMLElement>('#results')!;
const annotatedContainer = document.querySelector<HTMLElement>('#annotated-text')!;
const correctedTextEl = document.querySelector<HTMLElement>('#corrected-text')!;
const correctionsList = document.querySelector<HTMLElement>('#corrections-list')!;
const correctionsCount = document.querySelector<HTMLElement>('#corrections-count')!;
const statusIndicator = document.querySelector<HTMLElement>('#status-indicator')!;

const registry = new ToolRegistry();
let proofreadTool: Tool | null = null;

async function init() {
  console.log('[proofread-demo] typeof Proofreader:', typeof Proofreader);
  try {
    await ProofreadTool.addToRegistry(registry, {
      onDownloadProgress: ({ loaded, total }) => {
        const pct = total > 0 ? Math.round((loaded / total) * 100) : 0;
        console.log(`[proofread-demo] Download progress: ${loaded}/${total} (${pct}%)`);
        proofreadBtn.textContent = `Downloading… ${pct}%`;
        statusBadge.textContent = `Downloading… ${pct}%`;
      },
    });
    proofreadTool = registry.getTool('proofread')!;
    console.log('[proofread-demo] Ready.');
    statusBadge.textContent = 'Available';
    statusBadge.className = 'status-badge available';
    proofreadBtn.disabled = false;
  } catch (err) {
    console.error('[proofread-demo] Initialization failed:', err);
    statusBadge.textContent = 'Unavailable';
    statusBadge.className = 'status-badge unavailable';
  }
}

async function runProofread() {
  const text = textarea.value.trim();
  if (!text) return;

  proofreadBtn.disabled = true;
  proofreadBtn.textContent = 'Checking…';
  statusIndicator.textContent = 'Running…';
  statusIndicator.className = 'status-indicator running';

  try {
    const result = (await proofreadTool!.call({ text }, {})) as ProofreadResult;
    console.log('[proofread-demo] result:', JSON.stringify(result));
    renderResults(text, result);
  } catch (err) {
    console.error('[proofread-demo] Error:', err);
    renderError(err instanceof Error ? err.message : String(err));
  } finally {
    proofreadBtn.disabled = false;
    proofreadBtn.textContent = 'Proofread';
    statusIndicator.textContent = 'Idle';
    statusIndicator.className = 'status-indicator';
  }
}

function renderResults(originalText: string, { correctedInput, corrections }: ProofreadResult) {
  resultsSection.hidden = false;

  annotatedContainer.innerHTML = '';
  annotatedContainer.appendChild(buildAnnotatedText(originalText, corrections));

  correctedTextEl.textContent = correctedInput;

  correctionsList.innerHTML = '';
  correctionsCount.textContent =
    corrections.length === 0
      ? 'No issues found'
      : `${corrections.length} issue${corrections.length === 1 ? '' : 's'} found`;

  if (corrections.length === 0) {
    const msg = document.createElement('p');
    msg.className = 'no-issues';
    msg.textContent = '✓ No spelling or grammar issues detected.';
    correctionsList.appendChild(msg);
    return;
  }

  for (const c of corrections) {
    correctionsList.appendChild(buildCorrectionCard(originalText, c));
  }
}

function renderError(message: string) {
  resultsSection.hidden = false;
  annotatedContainer.innerHTML = '';
  correctionsList.innerHTML = '';
  correctionsCount.textContent = '';
  const err = document.createElement('p');
  err.className = 'error-message';
  err.textContent = `Error: ${message}`;
  correctionsList.appendChild(err);
}

function buildAnnotatedText(text: string, corrections: ProofreadCorrection[]): DocumentFragment {
  const sorted = [...corrections].sort((a, b) => a.startIndex - b.startIndex);
  const fragment = document.createDocumentFragment();
  let cursor = 0;

  for (const c of sorted) {
    if (c.startIndex < cursor) continue; // skip overlapping spans
    if (c.startIndex > cursor) {
      fragment.appendChild(document.createTextNode(text.slice(cursor, c.startIndex)));
    }
    const mark = document.createElement('mark');
    mark.textContent = text.slice(c.startIndex, c.endIndex);
    mark.title = `→ ${c.correction}`;
    fragment.appendChild(mark);
    cursor = c.endIndex;
  }

  if (cursor < text.length) {
    fragment.appendChild(document.createTextNode(text.slice(cursor)));
  }

  return fragment;
}

function buildCorrectionCard(originalText: string, c: ProofreadCorrection): HTMLElement {
  const card = document.createElement('div');
  card.className = 'correction-card';

  const original = document.createElement('span');
  original.className = 'correction-original';
  original.textContent = originalText.slice(c.startIndex, c.endIndex);

  const arrow = document.createElement('span');
  arrow.className = 'correction-arrow';
  arrow.textContent = '→';

  const corrected = document.createElement('span');
  corrected.className = 'correction-replacement';
  corrected.textContent = c.correction;

  card.appendChild(original);
  card.appendChild(arrow);
  card.appendChild(corrected);
  return card;
}

sampleBtn.addEventListener('click', () => {
  textarea.value = SAMPLE_TEXT;
  textarea.focus();
});

proofreadBtn.addEventListener('click', runProofread);

init();
