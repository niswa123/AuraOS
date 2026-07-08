/**
 * AuraOS State & Memory Engine - Embedding Providers
 * Abstraction layer for converting text into vector embeddings.
 * Supports OpenAI API and a local deterministic hasher for testing.
 */

import type { EmbeddingProvider } from './types.js';

// ─── OpenAI Embedding Provider ───

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'openai';
  readonly dimension = 1536;
  private apiKey: string;
  private model: string;
  private baseUrl: string;

  constructor(opts?: { apiKey?: string; model?: string; baseUrl?: string }) {
    this.apiKey = opts?.apiKey || process.env.OPENAI_API_KEY || '';
    this.model = opts?.model || 'text-embedding-3-small';
    this.baseUrl = opts?.baseUrl || 'https://api.openai.com/v1';

    if (!this.apiKey) {
      throw new Error(
        'OpenAI API key not found. Set OPENAI_API_KEY in .env or pass it to the constructor.'
      );
    }
  }

  async embed(text: string): Promise<number[]> {
    const results = await this.embedBatch([text]);
    return results[0];
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const response = await fetch(`${this.baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        input: texts,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI Embedding API error (${response.status}): ${error}`);
    }

    const data = await response.json() as {
      data: Array<{ embedding: number[]; index: number }>;
    };

    // Sort by index to maintain input order
    return data.data
      .sort((a, b) => a.index - b.index)
      .map(d => d.embedding);
  }
}

// ─── Local Deterministic Embedding Provider (for testing without API keys) ───

export class LocalEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'local-hash';
  readonly dimension: number;

  constructor(dimension: number = 1536) {
    this.dimension = dimension;
  }

  async embed(text: string): Promise<number[]> {
    return this.hashToVector(text);
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    return texts.map(t => this.hashToVector(t));
  }

  /**
   * Deterministic hash-based pseudo-embedding.
   * Maps text to a fixed-dimension normalized vector using character-level hashing.
   * NOT suitable for production semantic search; use only for integration testing.
   */
  private hashToVector(text: string): number[] {
    const vector = new Float64Array(this.dimension);
    const normalized = text.toLowerCase().trim();

    // Seed the vector with deterministic values derived from the text
    for (let i = 0; i < normalized.length; i++) {
      const charCode = normalized.charCodeAt(i);
      const idx = (charCode * 31 + i * 7) % this.dimension;
      vector[idx] += Math.sin(charCode * (i + 1) * 0.1);
    }

    // Also encode character bigrams for slightly better differentiation
    for (let i = 0; i < normalized.length - 1; i++) {
      const bigram = normalized.charCodeAt(i) * 256 + normalized.charCodeAt(i + 1);
      const idx = bigram % this.dimension;
      vector[idx] += Math.cos(bigram * 0.01);
    }

    // L2-normalize the vector
    let norm = 0;
    for (let i = 0; i < this.dimension; i++) {
      norm += vector[i] * vector[i];
    }
    norm = Math.sqrt(norm);
    if (norm > 0) {
      for (let i = 0; i < this.dimension; i++) {
        vector[i] /= norm;
      }
    }

    return Array.from(vector);
  }
}

// ─── Factory ───

export function createEmbeddingProvider(type?: 'openai' | 'local'): EmbeddingProvider {
  const providerType = type || (process.env.OPENAI_API_KEY ? 'openai' : 'local');

  if (providerType === 'openai') {
    return new OpenAIEmbeddingProvider();
  }

  console.warn(
    '[AuraOS Memory] Using local hash-based embeddings (testing mode). ' +
    'Set OPENAI_API_KEY for production-quality semantic search.'
  );
  return new LocalEmbeddingProvider();
}
