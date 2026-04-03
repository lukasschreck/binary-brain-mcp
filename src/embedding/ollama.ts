/**
 * OllamaProvider — Local embeddings via Ollama.
 *
 * Runs entirely offline. Requires Ollama running locally.
 * Default model: nomic-embed-text (768d).
 */

import type { EmbeddingProvider } from './provider.js';

export class OllamaProvider implements EmbeddingProvider {
  readonly type = 'ollama' as const;
  readonly dimensions: number;
  private baseUrl: string;
  private model: string;

  constructor(baseUrl: string = 'http://localhost:11434', model: string = 'nomic-embed-text', dimensions: number = 768) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.model = model;
    this.dimensions = dimensions;
  }

  async embed(text: string): Promise<number[]> {
    const response = await fetch(`${this.baseUrl}/api/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        input: text,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Ollama API error (${response.status}): ${error}`);
    }

    const data = await response.json() as OllamaResponse;
    return data.embeddings[0];
  }
}

interface OllamaResponse {
  embeddings: number[][];
}
