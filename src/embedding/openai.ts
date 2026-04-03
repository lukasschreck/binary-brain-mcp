/**
 * OpenAIProvider — OpenAI text-embedding-3-small.
 *
 * Good quality, widely available. Requires API key.
 */

import type { EmbeddingProvider } from './provider.js';

const OPENAI_API_URL = 'https://api.openai.com/v1/embeddings';

export class OpenAIProvider implements EmbeddingProvider {
  readonly type = 'openai' as const;
  readonly dimensions: number;
  private apiKey: string;

  constructor(apiKey: string, dimensions: number = 256) {
    if (!apiKey) throw new Error('OpenAI API key required. Set openai.apiKey in config.');
    this.apiKey = apiKey;
    this.dimensions = dimensions;
  }

  async embed(text: string): Promise<number[]> {
    const response = await fetch(OPENAI_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: 'text-embedding-3-small',
        dimensions: this.dimensions,
        input: text,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI API error (${response.status}): ${error}`);
    }

    const data = await response.json() as OpenAIResponse;
    return data.data[0].embedding;
  }
}

interface OpenAIResponse {
  data: Array<{ embedding: number[] }>;
}
