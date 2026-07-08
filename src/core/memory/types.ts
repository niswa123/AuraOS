/**
 * AuraOS State & Memory Engine - Type Definitions
 * Contracts for state serialization, memory storage, and recall operations.
 */

// ─── State Serialization Types ───

export interface AgentState {
  /** Agent UUID */
  agentId: string;
  /** Execution UUID this state belongs to */
  executionId: string;
  /** Serialized scope variables (key-value map) */
  variables: Record<string, unknown>;
  /** Snapshot of the agent's internal memory references */
  memorySnapshot: {
    totalMemories: number;
    lastRecallQuery?: string;
    lastRecallTimestamp?: string;
  };
  /** Timestamp of serialization */
  serializedAt: string;
}

export interface StateSerializeRequest {
  agentId: string;
  executionId: string;
  variables: Record<string, unknown>;
}

export interface StateSerializeResponse {
  action: 'state.serialize';
  success: boolean;
  stateId: string;
  serializedAt: string;
  sizeBytes: number;
}

export interface StateHydrateResponse {
  action: 'state.hydrate';
  success: boolean;
  state: AgentState | null;
  restoredAt: string;
}

// ─── Memory Engine Types ───

export interface MemoryEntry {
  id: string;
  agentId: string;
  content: string;
  metadata: Record<string, unknown>;
  embedding: number[];
  createdAt: string;
}

export interface MemoryRememberRequest {
  action: 'memory.remember';
  payload: {
    agentId: string;
    content: string;
    metadata?: Record<string, unknown>;
  };
}

export interface MemoryRememberResponse {
  action: 'memory.remember';
  success: boolean;
  memoryId: string;
  embeddingDimension: number;
  storedAt: string;
}

export interface MemoryRecallRequest {
  action: 'memory.recall';
  payload: {
    agentId: string;
    query: string;
    limit?: number;
    minSimilarity?: number;
  };
}

export interface MemoryRecallResult {
  memoryId: string;
  content: string;
  metadata: Record<string, unknown>;
  similarity: number;
  createdAt: string;
}

export interface MemoryRecallResponse {
  action: 'memory.recall';
  success: boolean;
  results: MemoryRecallResult[];
  query: string;
  totalMatches: number;
  searchDurationMs: number;
}

// ─── Embedding Provider Types ───

export interface EmbeddingProvider {
  readonly name: string;
  readonly dimension: number;
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
}
