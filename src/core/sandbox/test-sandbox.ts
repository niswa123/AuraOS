/**
 * AuraOS Cognitive Container - Integration Test Suite
 * Tests sandbox execution, timeout enforcement, and OOM protection.
 */

import { executeInSandbox } from './orchestrator.js';
import { DEFAULT_LIMITS } from './types.js';

async function runTests() {
  console.log('='.repeat(60));
  console.log('  AuraOS Cognitive Container - Integration Tests');
  console.log('='.repeat(60));

  let passed = 0;
  let failed = 0;

  // ─── Test 1: Python hello world ───
  try {
    console.log('\n[Test 1] Python: Simple print statement');
    const result = await executeInSandbox({
      executionId: 'test-python-hello',
      runtime: 'python',
      code: 'print("Hello from AuraOS sandbox!")',
      limits: DEFAULT_LIMITS,
    });

    if (result.exitCode === 0 && result.stdout.includes('Hello from AuraOS sandbox!')) {
      console.log('  PASSED: Output matches expected string.');
      passed++;
    } else {
      console.log(`  FAILED: exitCode=${result.exitCode}, stdout="${result.stdout}"`);
      failed++;
    }
  } catch (error: any) {
    console.log(`  FAILED: ${error.message}`);
    failed++;
  }

  // ─── Test 2: Node.js computation ───
  try {
    console.log('\n[Test 2] Node.js: Fibonacci computation');
    const code = `
      function fib(n) { return n <= 1 ? n : fib(n - 1) + fib(n - 2); }
      console.log("fib(10) =", fib(10));
    `;
    const result = await executeInSandbox({
      executionId: 'test-node-fib',
      runtime: 'node',
      code,
      limits: DEFAULT_LIMITS,
    });

    if (result.exitCode === 0 && result.stdout.includes('fib(10) = 55')) {
      console.log('  PASSED: Fibonacci result correct.');
      passed++;
    } else {
      console.log(`  FAILED: exitCode=${result.exitCode}, stdout="${result.stdout}"`);
      failed++;
    }
  } catch (error: any) {
    console.log(`  FAILED: ${error.message}`);
    failed++;
  }

  // ─── Test 3: Timeout enforcement ───
  try {
    console.log('\n[Test 3] Python: Timeout enforcement (infinite loop, 5s limit)');
    const result = await executeInSandbox({
      executionId: 'test-timeout',
      runtime: 'python',
      code: 'import time\nwhile True: time.sleep(0.1)',
      limits: {
        ...DEFAULT_LIMITS,
        timeoutMs: 5000, // Kill after 5 seconds
      },
    });

    if (result.timedOut) {
      console.log(`  PASSED: Container killed after timeout. Duration: ${result.durationMs}ms`);
      passed++;
    } else {
      console.log(`  FAILED: timedOut=${result.timedOut}, exitCode=${result.exitCode}`);
      failed++;
    }
  } catch (error: any) {
    console.log(`  FAILED: ${error.message}`);
    failed++;
  }

  // ─── Test 4: Memory limit (OOM) enforcement ───
  try {
    console.log('\n[Test 4] Python: OOM protection (allocate 512MB with 64MB limit)');
    const result = await executeInSandbox({
      executionId: 'test-oom',
      runtime: 'python',
      code: 'x = "A" * (512 * 1024 * 1024)\nprint(len(x))',
      limits: {
        ...DEFAULT_LIMITS,
        memoryBytes: 64 * 1024 * 1024, // 64MB limit
        timeoutMs: 15_000,
      },
    });

    if (result.oomKilled || result.exitCode !== 0) {
      console.log(`  PASSED: Container killed by OOM or exited with error. oomKilled=${result.oomKilled}, exitCode=${result.exitCode}`);
      passed++;
    } else {
      console.log(`  FAILED: Expected OOM kill but got exitCode=${result.exitCode}`);
      failed++;
    }
  } catch (error: any) {
    console.log(`  FAILED: ${error.message}`);
    failed++;
  }

  // ─── Test 5: Stderr capture ───
  try {
    console.log('\n[Test 5] Python: Stderr capture (runtime error)');
    const result = await executeInSandbox({
      executionId: 'test-stderr',
      runtime: 'python',
      code: 'raise ValueError("Intentional test error")',
      limits: DEFAULT_LIMITS,
    });

    if (result.exitCode !== 0 && result.stderr.includes('ValueError')) {
      console.log('  PASSED: Stderr captured the ValueError correctly.');
      passed++;
    } else {
      console.log(`  FAILED: exitCode=${result.exitCode}, stderr="${result.stderr}"`);
      failed++;
    }
  } catch (error: any) {
    console.log(`  FAILED: ${error.message}`);
    failed++;
  }

  // ─── Test 6: Environment variable injection ───
  try {
    console.log('\n[Test 6] Node.js: Environment variable injection');
    const result = await executeInSandbox({
      executionId: 'test-env',
      runtime: 'node',
      code: 'console.log("AGENT_ID=" + process.env.AGENT_ID);',
      limits: DEFAULT_LIMITS,
      env: { AGENT_ID: 'agent-uuid-12345' },
    });

    if (result.exitCode === 0 && result.stdout.includes('AGENT_ID=agent-uuid-12345')) {
      console.log('  PASSED: Environment variable correctly injected.');
      passed++;
    } else {
      console.log(`  FAILED: exitCode=${result.exitCode}, stdout="${result.stdout}"`);
      failed++;
    }
  } catch (error: any) {
    console.log(`  FAILED: ${error.message}`);
    failed++;
  }

  // ─── Summary ───
  console.log('\n' + '='.repeat(60));
  console.log(`  Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
  console.log('='.repeat(60));

  process.exit(failed > 0 ? 1 : 0);
}

runTests();
