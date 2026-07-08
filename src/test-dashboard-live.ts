/**
 * AuraOS Developer Dashboard - Live Demonstration Script
 * Spins up a real container sandbox execution, updates variable states,
 * writes console logs, and streams all events live to the dashboard via WebSockets.
 */

import dotenv from 'dotenv';
dotenv.config();

import { db } from './core/db/client.js';
import { executeInSandbox } from './core/sandbox/orchestrator.js';
import { liveStream } from './core/events/live-stream.js';
import { eventBroker } from './core/scheduler/event-broker.js';
import { DEFAULT_LIMITS } from './core/sandbox/types.js';

async function runDemo() {
  console.log('='.repeat(60));
  console.log('  AuraOS Control Center - Live Demonstration Run');
  console.log('='.repeat(60));

  // Initialize the WebSocket connection server
  liveStream.start(8085);
  console.log('WebSocket stream started. Ensure your browser is open at http://localhost:5173/');
  console.log('Waiting 5 seconds for dashboard to connect...');
  await new Promise(resolve => setTimeout(resolve, 5000));

  // 1. Create a real database agent entry
  const agentName = 'Realtime Matrix Processor';
  const agentRes = await db.query(
    "INSERT INTO agents (name, configuration) VALUES ($1, $2) RETURNING id",
    [agentName, JSON.stringify({ runtime: 'python', limits: { memoryMb: 128 } })]
  );
  const agentId = agentRes.rows[0].id;

  const execRes = await db.query(
    "INSERT INTO executions (agent_id, status) VALUES ($1, $2) RETURNING id",
    [agentId, 'running']
  );
  const executionId = execRes.rows[0].id;

  console.log(`\nCreated Agent in DB: ${agentId}`);
  
  // Register execution in broker
  eventBroker.registerExecution(agentId, executionId);

  // Broadcast running state and trigger timeline
  liveStream.sendStatus(agentId, 'running', agentName, 'python');
  liveStream.sendTimelineTransition(agentId, 'Active');
  liveStream.sendLog(agentId, 'Spawned sandbox container instance.', 'system');

  // Set up mock state variables
  const variables = {
    processor_core: 'cgroup_v2_cpu_0',
    memory_limit_bytes: 128 * 1024 * 1024,
    iterations_completed: 0,
    matrix_norm: 0.0
  };
  liveStream.sendStateUpdate(agentId, variables);

  // 2. Execute Python calculation inside sandbox
  const pythonCode = `
import time
print("Initializing neural weights array...")
time.sleep(1)
print("Processing iteration 1/3...")
time.sleep(1)
print("Processing iteration 2/3...")
time.sleep(1)
print("Processing iteration 3/3...")
print("Computation finished successfully.")
`;

  liveStream.sendLog(agentId, 'Starting sandbox execution...', 'system');

  const resultPromise = executeInSandbox({
    executionId,
    runtime: 'python',
    code: pythonCode,
    limits: {
      ...DEFAULT_LIMITS,
      memoryBytes: 128 * 1024 * 1024, // 128MB
    }
  });

  // Intercept sandbox outputs and stream them in real time
  // For the demo, we simulate log streaming delay matching sleep statements
  liveStream.sendLog(agentId, '[stdout] Initializing neural weights array...', 'stdout');
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  variables.iterations_completed = 1;
  variables.matrix_norm = 0.582;
  liveStream.sendStateUpdate(agentId, variables);
  liveStream.sendLog(agentId, '[stdout] Processing iteration 1/3...', 'stdout');
  await new Promise(resolve => setTimeout(resolve, 1000));

  variables.iterations_completed = 2;
  variables.matrix_norm = 0.814;
  liveStream.sendStateUpdate(agentId, variables);
  liveStream.sendLog(agentId, '[stdout] Processing iteration 2/3...', 'stdout');
  await new Promise(resolve => setTimeout(resolve, 1000));

  variables.iterations_completed = 3;
  variables.matrix_norm = 0.995;
  liveStream.sendStateUpdate(agentId, variables);
  liveStream.sendLog(agentId, '[stdout] Processing iteration 3/3...', 'stdout');
  
  const result = await resultPromise;
  
  liveStream.sendLog(agentId, `[stdout] ${result.stdout.split('\n').pop()}`, 'stdout');
  liveStream.sendLog(agentId, `Container execution completed. Exit code: ${result.exitCode}`, 'system');

  // 3. Trigger hibernation
  await new Promise(resolve => setTimeout(resolve, 2000));
  await eventBroker.hibernate({
    agentId,
    executionId,
    trigger: {
      type: 'webhook',
      details: { endpoint: `/webhook/${agentId}` }
    },
    variables
  });

  console.log('\nDemo run complete. Clean up agent in database.');
  await db.query('DELETE FROM agents WHERE id = $1', [agentId]);
  
  // Keep alive for 10 seconds to allow viewing final State: Sleep on screen
  console.log('Keeping WS connection active for 10 seconds. Check your dashboard!');
  await new Promise(resolve => setTimeout(resolve, 10000));
  
  liveStream.stop();
  process.exit(0);
}

runDemo().catch(console.error);
