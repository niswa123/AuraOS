/**
 * AuraOS State Engine
 * Handles serialization and hydration of agent runtime state.
 * Each state snapshot is stored as an immutable record in PostgreSQL,
 * enabling full execution history and point-in-time recovery.
 */

import { db } from '../db/client.js';
import type {
  AgentState,
  StateSerializeRequest,
  StateSerializeResponse,
  StateHydrateResponse,
} from './types.js';

/**
 * Serialize the current agent state to the database.
 * Creates an immutable snapshot linked to the agent and execution.
 */
export async function serializeState(req: StateSerializeRequest): Promise<StateSerializeResponse> {
  const serializedAt = new Date().toISOString();

  // Count total memories for this agent
  const memCountResult = await db.query(
    'SELECT COUNT(*)::int as total FROM vector_memories WHERE agent_id = $1',
    [req.agentId]
  );
  const totalMemories = memCountResult.rows[0]?.total || 0;

  const memorySnapshot = {
    totalMemories,
  };

  const variablesJson = JSON.stringify(req.variables);
  const sizeBytes = Buffer.byteLength(variablesJson, 'utf8');

  const result = await db.query(
    `INSERT INTO states (agent_id, execution_id, variables, memory_snapshot)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [req.agentId, req.executionId, req.variables, memorySnapshot]
  );

  const stateId = result.rows[0].id;

  console.log(
    `[AuraOS State] Serialized state ${stateId} for agent ${req.agentId} | ` +
    `Variables: ${Object.keys(req.variables).length} keys | Size: ${sizeBytes} bytes`
  );

  return {
    action: 'state.serialize',
    success: true,
    stateId,
    serializedAt,
    sizeBytes,
  };
}

/**
 * Hydrate the most recent state for a given agent.
 * Returns the latest state snapshot, or null if no state exists.
 */
export async function hydrateState(agentId: string): Promise<StateHydrateResponse> {
  const result = await db.query(
    `SELECT id, agent_id, execution_id, variables, memory_snapshot, created_at
     FROM states
     WHERE agent_id = $1
     ORDER BY created_at DESC
     LIMIT 1`,
    [agentId]
  );

  if (result.rows.length === 0) {
    return {
      action: 'state.hydrate',
      success: true,
      state: null,
      restoredAt: new Date().toISOString(),
    };
  }

  const row = result.rows[0];
  const state: AgentState = {
    agentId: row.agent_id,
    executionId: row.execution_id,
    variables: row.variables,
    memorySnapshot: row.memory_snapshot,
    serializedAt: row.created_at.toISOString(),
  };

  console.log(
    `[AuraOS State] Hydrated state for agent ${agentId} | ` +
    `From execution ${state.executionId} | ` +
    `Variables: ${Object.keys(state.variables).length} keys`
  );

  return {
    action: 'state.hydrate',
    success: true,
    state,
    restoredAt: new Date().toISOString(),
  };
}

/**
 * List all state snapshots for an agent (execution history).
 */
export async function listStateHistory(
  agentId: string,
  limit: number = 20
): Promise<{ stateId: string; executionId: string; variableCount: number; createdAt: string }[]> {
  const result = await db.query(
    `SELECT id, execution_id, variables, created_at
     FROM states
     WHERE agent_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [agentId, limit]
  );

  return result.rows.map(row => ({
    stateId: row.id,
    executionId: row.execution_id,
    variableCount: Object.keys(row.variables || {}).length,
    createdAt: row.created_at.toISOString(),
  }));
}
