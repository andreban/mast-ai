import type { UrpRequest, UrpResponse, UrpTransport } from '../adapter/urp';
import { AdapterError } from '../error';

export interface HttpTransportOptions {
  url: string;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

export class HttpTransport implements UrpTransport {
  constructor(private options: HttpTransportOptions) {}

  async send(request: UrpRequest): Promise<UrpResponse> {
    try {
      const response = await fetch(this.options.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.options.headers || {}),
        },
        body: JSON.stringify(request),
        signal: this.options.signal,
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
}
