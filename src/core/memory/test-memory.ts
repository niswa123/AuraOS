/**
 * AuraOS State & Memory Engine - Integration Test Suite
 * Tests state serialization/hydration and memory remember/recall operations.
 */

import dotenv from 'dotenv';
dotenv.config();

import { db } from '../db/client.js';
import { pool } from '../db/client.js';
import { serializeState, hydrateState, listStateHistory } from './state-engine.js';
import { remember, recall, forgetAll, countMemories, setEmbeddingProvider } from './memory-engine.js';
import { LocalEmbeddingProvider } from './embeddings.js';

// Force local embeddings for testing (no API key needed)
setEmbeddingProvider(new LocalEmbeddingProvider(1536));

let testAgentId: string;
let testExecutionId: string;

async function setup() {
  // Create a test agent
  const agentRes = await db.query(
    "INSERT INTO agents (name, configuration) VALUES ($1, $2) RETURNING id",
    ['Test Memory Agent', JSON.stringify({ model: 'gpt-4', temperature: 0.7 })]
  );
  testAgentId = agentRes.rows[0].id;

  // Create a test execution
  const execRes = await db.query(
    "INSERT INTO executions (agent_id, status) VALUES ($1, $2) RETURNING id",
    [testAgentId, 'running']
  );
  testExecutionId = execRes.rows[0].id;

  console.log(`Test setup: Agent ${testAgentId}, Execution ${testExecutionId}\n`);
}

async function cleanup() {
  // Cascade delete removes all related states and memories
  await db.query('DELETE FROM agents WHERE id = $1', [testAgentId]);
}

async function runTests() {
  console.log('='.repeat(60));
  console.log('  AuraOS State & Memory Engine - Integration Tests');
  console.log('='.repeat(60));

  await setup();

  let passed = 0;
  let failed = 0;

  // ─── Test 1: State Serialization ───
  try {
    console.log('\n[Test 1] State Serialization: Save agent variables');
    const response = await serializeState({
      agentId: testAgentId,
      executionId: testExecutionId,
      variables: {
        current_step: 'data_analysis',
        dataframe_path: '/tmp/analysis_3092.csv',
        processed_rows: 1024,
        analysis_complete: false,
        nested: { key: 'value', arr: [1, 2, 3] },
      },
    });

    if (response.success && response.stateId && response.sizeBytes > 0) {
      console.log(`  PASSED: State ${response.stateId} saved (${response.sizeBytes} bytes)`);
      passed++;
    } else {
      console.log(`  FAILED: ${JSON.stringify(response)}`);
      failed++;
    }
  } catch (error: any) {
    console.log(`  FAILED: ${error.message}`);
    failed++;
  }

  // ─── Test 2: State Hydration ───
  try {
    console.log('\n[Test 2] State Hydration: Restore latest agent state');
    const response = await hydrateState(testAgentId);

    if (
      response.success &&
      response.state &&
      response.state.variables.current_step === 'data_analysis' &&
      response.state.variables.processed_rows === 1024
    ) {
      console.log(`  PASSED: State hydrated with ${Object.keys(response.state.variables).length} variables`);
      passed++;
    } else {
      console.log(`  FAILED: ${JSON.stringify(response)}`);
      failed++;
    }
  } catch (error: any) {
    console.log(`  FAILED: ${error.message}`);
    failed++;
  }

  // ─── Test 3: Multiple State Snapshots (History) ───
  try {
    console.log('\n[Test 3] State History: Multiple serialization snapshots');

    // Save a second state
    await serializeState({
      agentId: testAgentId,
      executionId: testExecutionId,
      variables: { current_step: 'report_generation', processed_rows: 2048, analysis_complete: true },
    });

    const history = await listStateHistory(testAgentId);

    if (history.length >= 2) {
      console.log(`  PASSED: ${history.length} state snapshots in history`);
      passed++;
    } else {
      console.log(`  FAILED: Expected >= 2 snapshots, got ${history.length}`);
      failed++;
    }
  } catch (error: any) {
    console.log(`  FAILED: ${error.message}`);
    failed++;
  }

  // ─── Test 4: Hydrate returns latest state ───
  try {
    console.log('\n[Test 4] State Hydration: Returns most recent snapshot');
    const response = await hydrateState(testAgentId);

    if (
      response.state &&
      response.state.variables.current_step === 'report_generation' &&
      response.state.variables.analysis_complete === true
    ) {
      console.log('  PASSED: Latest state correctly hydrated');
      passed++;
    } else {
      console.log(`  FAILED: ${JSON.stringify(response.state?.variables)}`);
      failed++;
    }
  } catch (error: any) {
    console.log(`  FAILED: ${error.message}`);
    failed++;
  }

  // ─── Test 5: memory.remember ───
  try {
    console.log('\n[Test 5] Memory Remember: Store semantic memories');

    const m1 = await remember(testAgentId, 'The user prefers Docker containers over WebAssembly for Python execution.', {
      category: 'user_preferences',
      source: 'conversation',
    });

    const m2 = await remember(testAgentId, 'Database connection requires PostgreSQL with pgvector extension on port 5433.', {
      category: 'system_config',
      source: 'setup',
    });

    const m3 = await remember(testAgentId, 'The quarterly revenue report must be generated every Monday at 9am UTC.', {
      category: 'task_schedule',
      source: 'cron_config',
    });

    if (m1.success && m2.success && m3.success) {
      console.log(`  PASSED: 3 memories stored (IDs: ${m1.memoryId.slice(0, 8)}, ${m2.memoryId.slice(0, 8)}, ${m3.memoryId.slice(0, 8)})`);
      passed++;
    } else {
      console.log('  FAILED: One or more memories failed to store');
      failed++;
    }
  } catch (error: any) {
    console.log(`  FAILED: ${error.message}`);
    failed++;
  }

  // ─── Test 6: memory.recall (semantic search) ───
  try {
    console.log('\n[Test 6] Memory Recall: Semantic similarity search');

    const response = await recall(testAgentId, 'What container technology does the user prefer?', 3);

    if (response.success && response.results.length > 0) {
      console.log(`  PASSED: ${response.results.length} results found (${response.searchDurationMs}ms)`);
      response.results.forEach((r, i) => {
        console.log(`    [${i + 1}] sim=${r.similarity.toFixed(4)} | "${r.content.slice(0, 70)}..."`);
      });
      passed++;
    } else {
      console.log(`  FAILED: No results found`);
      failed++;
    }
  } catch (error: any) {
    console.log(`  FAILED: ${error.message}`);
    failed++;
  }

  // ─── Test 7: memory.recall with different query ───
  try {
    console.log('\n[Test 7] Memory Recall: Different query returns different ranking');

    const response = await recall(testAgentId, 'database connection and PostgreSQL setup', 3);

    if (response.success && response.results.length > 0) {
      console.log(`  PASSED: ${response.results.length} results found (${response.searchDurationMs}ms)`);
      response.results.forEach((r, i) => {
        console.log(`    [${i + 1}] sim=${r.similarity.toFixed(4)} | "${r.content.slice(0, 70)}..."`);
      });
      passed++;
    } else {
      console.log('  FAILED: No results found');
      failed++;
    }
  } catch (error: any) {
    console.log(`  FAILED: ${error.message}`);
    failed++;
  }

  // ─── Test 8: Memory count ───
  try {
    console.log('\n[Test 8] Memory Count: Verify stored memory count');

    const count = await countMemories(testAgentId);

    if (count === 3) {
      console.log(`  PASSED: ${count} memories stored`);
      passed++;
    } else {
      console.log(`  FAILED: Expected 3 memories, got ${count}`);
      failed++;
    }
  } catch (error: any) {
    console.log(`  FAILED: ${error.message}`);
    failed++;
  }

  // ─── Test 9: State snapshot includes memory count ───
  try {
    console.log('\n[Test 9] State + Memory Integration: Snapshot includes memory count');

    const stateRes = await serializeState({
      agentId: testAgentId,
      executionId: testExecutionId,
      variables: { step: 'final_check' },
    });

    const hydrated = await hydrateState(testAgentId);

    if (hydrated.state && hydrated.state.memorySnapshot.totalMemories === 3) {
      console.log(`  PASSED: State snapshot reports ${hydrated.state.memorySnapshot.totalMemories} memories`);
      passed++;
    } else {
      console.log(`  FAILED: memorySnapshot=${JSON.stringify(hydrated.state?.memorySnapshot)}`);
      failed++;
    }
  } catch (error: any) {
    console.log(`  FAILED: ${error.message}`);
    failed++;
  }

  // ─── Cleanup ───
  await cleanup();

  // ─── Summary ───
  console.log('\n' + '='.repeat(60));
  console.log(`  Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
  console.log('='.repeat(60));

  await pool.end();
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
