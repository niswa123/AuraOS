-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Table for tracking AI agents
CREATE TABLE IF NOT EXISTS agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  configuration JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Table for tracking agent execution tasks
CREATE TABLE IF NOT EXISTS executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  status VARCHAR(50) NOT NULL DEFAULT 'initialized',
  logs TEXT,
  token_usage JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Table for serialization and checkpoints of state history
CREATE TABLE IF NOT EXISTS states (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  execution_id UUID REFERENCES executions(id) ON DELETE SET NULL,
  variables JSONB NOT NULL DEFAULT '{}'::jsonb,
  memory_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Table for long-term vector semantic memory
CREATE TABLE IF NOT EXISTS vector_memories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  embedding vector(1536) NOT NULL, -- 1536 dimensions for OpenAI / standard models
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for performance optimizing queries
CREATE INDEX IF NOT EXISTS idx_executions_agent_id ON executions(agent_id);
CREATE INDEX IF NOT EXISTS idx_states_agent_id ON states(agent_id);
CREATE INDEX IF NOT EXISTS idx_vector_memories_agent_id ON vector_memories(agent_id);

-- HNSW Vector Index for efficient Cosine Similarity Search
CREATE INDEX IF NOT EXISTS vector_memories_embedding_hnsw_idx ON vector_memories USING hnsw (embedding vector_cosine_ops);
