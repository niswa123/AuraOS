/**
 * AuraOS Chronos Trigger System - Integration Test Suite
 * Verifies event-driven hibernation, webhook wakeup, and cron wakeup.
 */

import dotenv from 'dotenv';
dotenv.config();

import { db, pool } from '../db/client.js';
import { eventBroker } from './event-broker.js';
import { cronScheduler } from './cron-scheduler.js';
import { WebhookListener } from './webhook-listener.js';
import { hydrateState } from '../memory/state-engine.js';

let testAgentId: string;
let testExecutionId: string;

async function setup() {
  // Create a test agent
  const agentRes = await db.query(
    "INSERT INTO agents (name, configuration) VALUES ($1, $2) RETURNING id",
    ['Chronos Test Agent', JSON.stringify({ version: '1.0.0' })]
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
  await db.query('DELETE FROM agents WHERE id = $1', [testAgentId]);
}

async function runTests() {
  console.log('='.repeat(60));
  console.log('  AuraOS Chronos Trigger System - Integration Tests');
  console.log('='.repeat(60));

  await setup();

  let passed = 0;
  let failed = 0;

  // Start active execution mapping
  eventBroker.registerExecution(testAgentId, testExecutionId);

  // ─── Test 1: Hibernation & State Serialization ───
  try {
    console.log('\n[Test 1] Hibernation: Suspend execution & save state');
    
    const hibernateRes = await eventBroker.hibernate({
      agentId: testAgentId,
      executionId: testExecutionId,
      trigger: {
        type: 'webhook',
        details: { endpoint: `/webhook/${testAgentId}`, method: 'POST' }
      },
      variables: {
        current_step: 'awaiting_payment_confirmation',
        transaction_id: 'tx-99021',
        retry_count: 3
      }
    });

    // Check DB status
    const dbStatusRes = await db.query("SELECT status FROM executions WHERE id = $1", [testExecutionId]);
    const currentStatus = dbStatusRes.rows[0]?.status;

    // Check saved state variables
    const stateRes = await hydrateState(testAgentId);

    if (
      hibernateRes.success &&
      currentStatus === 'hibernating' &&
      stateRes.state?.variables.current_step === 'awaiting_payment_confirmation'
    ) {
      console.log('  PASSED: Hibernation succeeded, state serialized, container marked sleeping.');
      passed++;
    } else {
      console.log(`  FAILED: status=${currentStatus}, variables=${JSON.stringify(stateRes.state?.variables)}`);
      failed++;
    }
  } catch (error: any) {
    console.log(`  FAILED: ${error.message}`);
    failed++;
  }

  // ─── Test 2: Webhook Wakeup Trigger ───
  try {
    console.log('\n[Test 2] Wakeup Trigger: Webhook listener dispatch');

    // Start Webhook listener on custom test port 8082
    const testListener = new WebhookListener(8082);
    await testListener.start();

    // Set up wakeup listener callback to verify Event Broker catches it
    let wakeupFired = false;
    let triggerTypeCaptured = '';
    let payloadCaptured: any = null;

    const unbind = eventBroker.onWakeup((agentId, type, payload) => {
      if (agentId === testAgentId) {
        wakeupFired = true;
        triggerTypeCaptured = type;
        payloadCaptured = payload;
      }
    });

    // Simulate an external HTTP webhook request using fetch
    const response = await fetch(`http://localhost:8082/webhook/${testAgentId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transaction_status: 'completed', amount: 250.00 })
    });

    const responseBody = await response.json() as any;

    // Wait short delay to ensure async broker operations finish
    await new Promise(resolve => setTimeout(resolve, 500));

    // Verify DB status is updated to 'running'
    const dbStatusRes = await db.query("SELECT status FROM executions WHERE id = $1", [testExecutionId]);
    const currentStatus = dbStatusRes.rows[0]?.status;

    // Stop listener & unbind
    await testListener.stop();
    unbind();

    if (
      response.ok &&
      responseBody.success &&
      wakeupFired &&
      triggerTypeCaptured === 'webhook' &&
      currentStatus === 'running' &&
      payloadCaptured?.payload?.transaction_status === 'completed'
    ) {
      console.log('  PASSED: Webhook dispatch woke up agent, context hydrated, container running.');
      passed++;
    } else {
      console.log(
        `  FAILED: wakeupFired=${wakeupFired}, type=${triggerTypeCaptured}, ` +
        `status=${currentStatus}, payload=${JSON.stringify(payloadCaptured?.payload)}`
      );
      failed++;
    }
  } catch (error: any) {
    console.log(`  FAILED: ${error.message}`);
    failed++;
  }

  // ─── Test 3: Cron Wakeup Trigger ───
  try {
    console.log('\n[Test 3] Wakeup Trigger: Cron Scheduler matching');

    // Hibernate agent back to sleep
    await eventBroker.hibernate({
      agentId: testAgentId,
      executionId: testExecutionId,
      trigger: {
        type: 'cron',
        details: { cronExpression: '*/1 * * * * *' } // Try to fire every second
      },
      variables: { current_step: 'scheduled_health_check' }
    });

    let cronWakeupFired = false;
    const unbind = eventBroker.onWakeup((agentId, type) => {
      if (agentId === testAgentId && type === 'cron') {
        cronWakeupFired = true;
      }
    });

    // Register cron: Node-cron standard is 5-field, but supports 6-field with seconds.
    // Let's register a 1-second interval cron job
    cronScheduler.register(testAgentId, '*/1 * * * * *');

    // Wait 2 seconds for cron task to execute
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Clean up cron
    cronScheduler.stop(testAgentId);
    unbind();

    // Verify DB status
    const dbStatusRes = await db.query("SELECT status FROM executions WHERE id = $1", [testExecutionId]);
    const currentStatus = dbStatusRes.rows[0]?.status;

    if (cronWakeupFired && currentStatus === 'running') {
      console.log('  PASSED: Cron job fired scheduler wakeup, container is running.');
      passed++;
    } else {
      console.log(`  FAILED: cronWakeupFired=${cronWakeupFired}, status=${currentStatus}`);
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
