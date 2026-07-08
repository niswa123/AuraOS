/**
 * AuraOS Ad-hoc Sandbox Runner
 * Executes arbitrary scripts inside secure Docker containers
 * bypassing PostgreSQL database storage entirely.
 * Option to stream execution logs live to the dashboard.
 */

import { executeInSandbox } from './src/core/sandbox/orchestrator.js';
import { liveStream } from './src/core/events/live-stream.js';
import { DEFAULT_LIMITS } from './src/core/sandbox/types.js';

async function main() {
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.log('AuraOS Ad-hoc Sandbox Runner (Bypasses Database)');
    console.log('Usage:');
    console.log('  npx tsx run-code.ts <runtime: python|node> <code>');
    console.log('\nExample:');
    console.log('  npx tsx run-code.ts python "print(\'Hello from ad-hoc container sandbox!\')"');
    process.exit(1);
  }

  const runtime = args[0] as 'python' | 'node';
  const code = args[1];

  if (runtime !== 'python' && runtime !== 'node') {
    console.error('Error: Runtime must be "python" or "node"');
    process.exit(1);
  }

  const adhocId = `adhoc-${Date.now().toString().slice(-6)}`;
  const adhocName = `Ad-hoc Sandbox (${runtime.toUpperCase()})`;

  console.log('='.repeat(70));
  console.log(`📦 Initializing Direct Sandbox Container...`);
  console.log(`   Execution ID: ${adhocId}`);
  console.log(`   Runtime:      ${runtime}`);
  console.log('='.repeat(70));

  // Initialize WS stream connection to broadcast to dashboard in case it's open
  liveStream.start(8085);
  
  // Wait a brief moment to ensure socket registration
  await new Promise(resolve => setTimeout(resolve, 500));

  // Stream status to Dashboard
  liveStream.sendStatus(adhocId, 'running', adhocName, runtime);
  liveStream.sendTimelineTransition(adhocId, 'Active');
  liveStream.sendLog(adhocId, 'Spawning direct ad-hoc sandbox container (DB-bypass)...', 'system');
  liveStream.sendStateUpdate(adhocId, {
    mode: 'db_bypass_adhoc',
    memory_limit: '256MB',
    execution_id: adhocId
  });

  try {
    const result = await executeInSandbox({
      executionId: adhocId,
      runtime,
      code,
      limits: DEFAULT_LIMITS
    });

    console.log('\n--- Sandbox Output ---');
    if (result.stdout) {
      console.log(result.stdout);
      result.stdout.split('\n').forEach(line => {
        liveStream.sendLog(adhocId, line, 'stdout');
      });
    }
    if (result.stderr) {
      console.error(result.stderr);
      result.stderr.split('\n').forEach(line => {
        liveStream.sendLog(adhocId, line, 'stderr');
      });
    }
    console.log('----------------------');

    console.log(`\nExecution finished. Duration: ${result.durationMs}ms | Exit code: ${result.exitCode}`);
    if (result.oomKilled) console.log('⚠️ Warning: Container was killed by Out-of-Memory protector!');
    if (result.timedOut) console.log('⚠️ Warning: Container execution timed out and was SIGKILLed!');

    // Stream completion & teardown status
    liveStream.sendStatus(adhocId, 'completed', adhocName, runtime);
    liveStream.sendTimelineTransition(adhocId, 'Sleep');
    liveStream.sendLog(adhocId, `Execution finished in ${result.durationMs}ms. Container destroyed.`, 'system');

  } catch (err: any) {
    console.error('Sandbox error:', err.message);
    liveStream.sendLog(adhocId, `Sandbox error: ${err.message}`, 'stderr');
  } finally {
    // Keep WS connection alive briefly so dashboard renders final state
    await new Promise(resolve => setTimeout(resolve, 1500));
    liveStream.stop();
    process.exit(0);
  }
}

main();
