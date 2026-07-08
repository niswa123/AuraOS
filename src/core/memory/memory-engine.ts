/**
 * AuraOS Memory Engine
 * Long-term semantic memory for AI agents using PostgreSQL + pgvector.
 * Provides memory.remember (store) and memory.recall (search) operations.
 */

import { db } from '../db/client.js';
import { createEmbeddingProvider } from './embeddings.js';
import type {
  EmbeddingProvider,
  MemoryRememberResponse,
  MemoryRecallResponse,
  MemoryRecallResult,
} from './types.js';

let embeddingProvider: EmbeddingProvider | null = null;

function getProvider(): EmbeddingProvider {
  if (!embeddingProvider) {
    embeddingProvider = createEmbeddingProvider();
  }
  return embeddingProvider;
}

/**
 * Override the default embedding provider (useful for testing or custom models).
 */
export function setEmbeddingProvider(provider: EmbeddingProvider): void {
  embeddingProvider = provider;
}

/**
 * memory.remember - Store a new memory with its vector embedding.
 *
 * Flow:
 *   1. Convert content text into a vector embedding.
 *   2. Store content, metadata, and embedding into vector_memories table.
 *   3. Return confirmation with memory ID and dimensions.
 */
export async function remember(
  agentId: string,
  content: string,
  metadata: Record<string, unknown> = {}
): Promise<MemoryRememberResponse> {
  const provider = getProvider();

  // Generate embedding vector from content
  const embedding = await provider.embed(content);

  // Store in PostgreSQL with pgvector
  const result = await db.query(
    `INSERT INTO vector_memories (agent_id, content, metadata, embedding)
     VALUES ($1, $2, $3, $4)
     RETURNING id, created_at`,
    [agentId, content, metadata, `[${embedding.join(',')}]`]
  );

  const row = result.rows[0];

  console.log(
    `[AuraOS Memory] Stored memory ${row.id} for agent ${agentId} | ` +
    `Provider: ${provider.name} | Dimension: ${provider.dimension} | ` +
    `Content: "${content.slice(0, 60)}${content.length > 60 ? '...' : ''}"`
  );

  return {
    action: 'memory.remember',
    success: true,
    memoryId: row.id,
    embeddingDimension: provider.dimension,
    storedAt: row.created_at.toISOString(),
  };
}

/**
 * memory.recall - Search memories by semantic similarity.
 *
 * Flow:
 *   1. Convert query text into a vector embedding.
 *   2. Execute cosine distance search using pgvector's <=> operator.
 *   3. Filter by minimum similarity threshold.
 *   4. Return ranked results with similarity scores.
 */
export async function recall(
  agentId: string,
  query: string,
  limit: number = 5,
  minSimilarity: number = 0.0
): Promise<MemoryRecallResponse> {
  const provider = getProvider();
  const startTime = Date.now();

  // Generate embedding vector from query
  const queryEmbedding = await provider.embed(query);

  // Cosine distance search via pgvector
  // The <=> operator returns cosine distance (0 = identical, 2 = opposite)
  // We convert to similarity: 1 - distance
  const result = await db.query(
    `SELECT
       id,
       content,
       metadata,
       created_at,
       1 - (embedding <=> $1) AS similarity
     FROM vector_memories
     WHERE agent_id = $2
       AND 1 - (embedding <=> $1) >= $3
     ORDER BY embedding <=> $1
     LIMIT $4`,
    [`[${queryEmbedding.join(',')}]`, agentId, minSimilarity, limit]
  );

  const searchDurationMs = Date.now() - startTime;

  const results: MemoryRecallResult[] = result.rows.map(row => ({
    memoryId: row.id,
    content: row.content,
    metadata: row.metadata,
    similarity: parseFloat(row.similarity),
    createdAt: row.created_at.toISOString(),
  }));

  console.log(
    `[AuraOS Memory] Recall for agent ${agentId} | ` +
    `Query: "${query.slice(0, 50)}${query.length > 50 ? '...' : ''}" | ` +
    `Results: ${results.length}/${limit} | Duration: ${searchDurationMs}ms`
  );

  return {
    action: 'memory.recall',
    success: true,
    results,
    query,
    totalMatches: results.length,
    searchDurationMs,
  };
}

/**
 * Delete all memories for a specific agent.
 */
export async function forgetAll(agentId: string): Promise<{ deleted: number }> {
  const result = await db.query(
    'DELETE FROM vector_memories WHERE agent_id = $1',
    [agentId]
  );
  const deleted = result.rowCount || 0;
  console.log(`[AuraOS Memory] Deleted ${deleted} memories for agent ${agentId}`);
  return { deleted };
}

/**
 * Count total memories for a specific agent.
 */
export async function countMemories(agentId: string): Promise<number> {
  const result = await db.query(
    'SELECT COUNT(*)::int as total FROM vector_memories WHERE agent_id = $1',
    [agentId]
  );
  return result.rows[0]?.total || 0;
}
