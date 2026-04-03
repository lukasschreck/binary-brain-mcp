/**
 * JinaProvider — Jina AI jina-embeddings-v3.
 *
 * Best multilingual quality. Requires API key.
 * Default: 256 dimensions, text-matching task.
 */

import type { EmbeddingProvider } from './provider.js';

const JINA_API_URL = 'https://api.jina.ai/v1/embeddings';

export class JinaProvider implements EmbeddingProvider {
  readonly type = 'jina' as const;
  readonly dimensions: number;
  private apiKey: string;

  constructor(apiKey: string, dimensions: number = 256) {
    if (!apiKey) throw new Error('Jina API key required. Set jina.apiKey in config.');
    this.apiKey = apiKey;
    this.dimensions = dimensions;
  }

  async embed(text: string): Promise<number[]> {
    const response = await fetch(JINA_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: 'jina-embeddings-v3',
        task: 'text-matching',
        dimensions: this.dimensions,
        late_chunking: false,
        input: [text],
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Jina API error (${response.status}): ${error}`);
    }

    const data = await response.json() as JinaResponse;
    return data.data[0].embedding;
  }
}

interface JinaResponse {
  data: Array<{ embedding: number[] }>;
}
