/**
 * EmbeddingProvider — Interface für alle Embedding Backends.
 *
 * NoneProvider (Default), JinaProvider, OpenAIProvider, LocalProvider, OllamaProvider.
 */

export interface EmbeddingProvider {
  readonly type: 'none' | 'local' | 'jina' | 'openai' | 'ollama';
  readonly dimensions: number;

  /** Generate embedding vector for text. Returns empty array for NoneProvider. */
  embed(text: string): Promise<number[]>;
}

/**
 * Prepares text for embedding: combines title and content.
 * raw_content is intentionally excluded — too long/noisy for good embeddings.
 */
export function prepareEmbeddingText(title: string, content: string): string {
  return `${title}: ${content}`;
}
