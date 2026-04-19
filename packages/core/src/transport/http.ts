// Copyright 2026 Andre Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import type { UrpRequest, UrpResponse, UrpTransport, UrpStreamChunk } from '../adapter/urp';
import { AdapterError } from '../error';

export interface HttpTransportOptions {
  url: string;
  headers?: Record<string, string>;
}

export class HttpTransport implements UrpTransport {
  constructor(private options: HttpTransportOptions) {}

  async send(request: UrpRequest, signal?: AbortSignal): Promise<UrpResponse> {
    try {
      const response = await fetch(this.options.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.options.headers || {}),
        },
        body: JSON.stringify(request),
        signal,
      });

      if (!response.ok) {
        throw new AdapterError(
          `HTTP request failed with status ${response.status}`,
          response.status
        );
      }

      const data = await response.json();
      return data as UrpResponse;
    } catch (error) {
      if (error instanceof AdapterError) {
        throw error;
      }
      throw new AdapterError(
        `Failed to send request: ${error instanceof Error ? error.message : String(error)}`,
        undefined,
        error
      );
    }
  }

  async *sendStream(request: UrpRequest, signal?: AbortSignal): AsyncIterable<UrpStreamChunk> {
    let response: Response;
    try {
      response = await fetch(this.options.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'text/event-stream, application/x-ndjson, application/json',
          ...(this.options.headers || {}),
        },
        body: JSON.stringify({ ...request, stream: true }),
        signal,
      });
    } catch (error) {
      throw new AdapterError(
        `Failed to send streaming request: ${error instanceof Error ? error.message : String(error)}`,
        undefined,
        error
      );
    }

    if (!response.ok) {
      throw new AdapterError(
        `HTTP streaming request failed with status ${response.status}`,
        response.status
      );
    }

    if (!response.body) {
      throw new AdapterError('Response body is empty');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          // Support both simple NDJSON and SSE (data: ...)
          const jsonStr = trimmed.startsWith('data: ') ? trimmed.slice(6) : trimmed;
          if (jsonStr === '[DONE]') continue;

          try {
            yield JSON.parse(jsonStr) as UrpStreamChunk;
          } catch (e) {
            throw new AdapterError(`Failed to parse URP stream chunk: ${jsonStr}`, undefined, e);
          }
        }
      }

      // Handle remaining buffer
      if (buffer.trim()) {
        const trimmed = buffer.trim();
        const jsonStr = trimmed.startsWith('data: ') ? trimmed.slice(6) : trimmed;
        if (jsonStr !== '[DONE]') {
          try {
            yield JSON.parse(jsonStr) as UrpStreamChunk;
          } catch (e) {
            throw new AdapterError(`Failed to parse URP stream chunk: ${jsonStr}`, undefined, e);
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}
