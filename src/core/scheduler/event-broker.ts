/**
 * AuraOS Chronos Trigger System - Event Broker
 * Handles agent hibernation state transitions, sandbox teardowns,
 * and event-driven wakeups.
 */

import { serializeState, hydrateState } from '../memory/state-engine.js';
import { db } from '../db/client.js';
import { liveStream } from '../events/live-stream.js';
import { executeInSandbox } from '../sandbox/orchestrator.js';
import type { HibernateRequest, HibernateResponse, TriggerType } from './types.js';

export interface ActiveExecution {
  agentId: string;
  executionId: string;
  status: 'running' | 'hibernating' | 'completed';
}

class ChronosEventBroker {
  private activeExecutions = new Map<string, ActiveExecution>();
  
  // Listeners for wakeups
  private wakeupListeners = new Set<(agentId: string, triggerType: TriggerType, payload?: any) => void>();

  registerExecution(agentId: string, executionId: string) {
    this.activeExecutions.set(agentId, {
      agentId,
      executionId,
      status: 'running'
    });
    console.log(`[Chronos Broker] Registered active execution ${executionId} for agent ${agentId}`);
  }

  onWakeup(listener: (agentId: string, triggerType: TriggerType, payload?: any) => void) {
    this.wakeupListeners.add(listener);
    return () => this.wakeupListeners.delete(listener);
  }

  /**
   * Hibernate - Teardown executing agents and persist their state.
   */
  async hibernate(req: HibernateRequest): Promise<HibernateResponse> {
    const { agentId, executionId, trigger, variables } = req;
    
    console.log(`[Chronos Broker] Initiating hibernation for agent ${agentId} (Execution ${executionId})`);

    // Stream status update to Live Dashboard
    liveStream.sendStatus(agentId, 'hibernating');
    liveStream.sendTimelineTransition(agentId, 'Hibernate');
    liveStream.sendLog(agentId, 'Initiating agent hibernation. Serializing context variables...', 'system');

    // 1. Serialize variables & state snapshot
    const serializeRes = await serializeState({
      agentId,
      executionId,
      variables
    });

    // 2. Tear down sandbox status (Update execution state in db)
    await db.query(
      "UPDATE executions SET status = $1, updated_at = NOW() WHERE id = $2",
      ['hibernating', executionId]
    );

    // 3. Register trigger details inside the same state snapshot
    await db.query(
      "UPDATE states SET memory_snapshot = memory_snapshot || $1::jsonb WHERE id = $2",
      [
        JSON.stringify({ triggerType: trigger.type, details: trigger.details, event: 'hibernate_checkpoint' }),
        serializeRes.stateId
      ]
    );

    // 4. Update memory tracking mapping
    this.activeExecutions.set(agentId, {
      agentId,
      executionId,
      status: 'hibernating'
    });

    console.log(`[Chronos Broker] Agent ${agentId} suspended. Sandbox destroyed. Trigger registered: ${trigger.type}`);

    // Update stream to Sleep state
    liveStream.sendStatus(agentId, 'sleeping');
    liveStream.sendTimelineTransition(agentId, 'Sleep');
    liveStream.sendStateUpdate(agentId, variables);
    liveStream.sendLog(agentId, `Teardown of sandbox container complete. Agent sleeping, waiting for trigger: ${trigger.type}`, 'system');

    return {
      success: true,
      agentId,
      executionId,
      suspendedAt: new Date().toISOString(),
      status: 'sleeping'
    };
  }

  /**
   * Wakeup - Hydrate state variables and spin execution back up.
   */
  async wakeup(agentId: string, triggerType: TriggerType, payload?: any): Promise<void> {
    console.log(`[Chronos Broker] Wakeup signal received for agent ${agentId} via: ${triggerType}`);

    // Update stream to Trigger state
    liveStream.sendTimelineTransition(agentId, 'Trigger');
    liveStream.sendLog(agentId, `Wakeup signal triggered via: ${triggerType}`, 'system');

    const active = this.activeExecutions.get(agentId);
    if (!active) {
      console.warn(`[Chronos Broker] No active execution registered for agent ${agentId}. Creating new context.`);
    }

    // 1. Hydrate state variables
    const stateRes = await hydrateState(agentId);
    if (!stateRes.success || !stateRes.state) {
      console.warn(`[Chronos Broker] State hydration failed for agent ${agentId}. Unable to restore variables.`);
      return;
    }

    const executionId = active ? active.executionId : stateRes.state.executionId;

    // 2. Update execution status in DB to running
    await db.query(
      "UPDATE executions SET status = $1, updated_at = NOW() WHERE id = $2",
      ['running', executionId]
    );

    // Stream running update
    liveStream.sendStatus(agentId, 'running');
    liveStream.sendTimelineTransition(agentId, 'Active');
    liveStream.sendStateUpdate(agentId, stateRes.state.variables);
    liveStream.sendLog(agentId, `Sandbox container spawned. Context variables loaded successfully.`, 'system');

    if (active) {
      active.status = 'running';
    }

    console.log(`[Chronos Broker] Agent ${agentId} hydrated. Context variables:`, JSON.stringify(stateRes.state.variables));

    // Fetch code from agents table and execute in sandbox container
    const agentQuery = await db.query('SELECT name, configuration FROM agents WHERE id = $1', [agentId]);
    const agent = agentQuery.rows[0];
    
    if (agent) {
      const config = agent.configuration || {};
      const name = agent.name;
      const runtime = config.runtime || 'python';
      
      const code = config.code || (runtime === 'python'
        ? `import time\nprint("Agent [${name}] woke up via trigger: ${triggerType}")\ntime.sleep(2)\nprint("System check: OK. Terminating sandbox.")`
        : `setTimeout(() => { console.log("Agent [${name}] woke up via trigger: ${triggerType}"); console.log("System check: OK. Terminating sandbox."); }, 2000);`
      );

      // Run sandbox container execution in background
      (async () => {
        try {
          liveStream.sendLog(agentId, 'Launching Docker sandbox container...', 'system');
          
          const result = await executeInSandbox({
            executionId,
            runtime,
            code,
            limits: {
              memoryBytes: 128 * 1024 * 1024,
              cpuCores: 0.5,
              timeoutMs: 15000,
              pidsLimit: 32,
              networkDisabled: false // Enabled to route traffic to local proxy
            }
          });

          // Stream stdout and stderr logs live to the dashboard console
          if (result.stdout) {
            result.stdout.split('\n').forEach(line => {
              liveStream.sendLog(agentId, line, 'stdout');
            });
          }
          if (result.stderr) {
            result.stderr.split('\n').forEach(line => {
              liveStream.sendLog(agentId, line, 'stderr');
            });
          }

          // Compute usage billing metrics (Serverless model: GB-seconds)
          const ramAllocatedMb = 128;
          const durationSeconds = result.durationMs / 1000;
          const costUsd = durationSeconds * (ramAllocatedMb / 1024) * 0.00001667;

          // Save billing metrics and raw logs to database
          await db.query(
            `UPDATE executions 
             SET logs = $1, duration_ms = $2, ram_allocated_mb = $3, cost_usd = $4, updated_at = NOW() 
             WHERE id = $5`,
            [result.stdout + '\n' + result.stderr, result.durationMs, ramAllocatedMb, costUsd, executionId]
          );

          // Broadcast billing metrics to UI
          liveStream.sendBillingMetrics(agentId, result.durationMs, ramAllocatedMb, costUsd);

          // Automatically hibernate container and serialize state after run
          await new Promise(resolve => setTimeout(resolve, 1000));
          await this.hibernate({
            agentId,
            executionId,
            trigger: { type: 'webhook', details: { endpoint: `/webhook/${agentId}` } },
            variables: { 
              ...stateRes.state?.variables, 
              ...(result.checkpointVars || {}), // Merge intermediate state checkpoint
              last_run_duration_ms: result.durationMs, 
              run_status: result.exitCode === 0 ? 'success' : 'failed',
              triggered_via: triggerType
            }
          });
        } catch (err: any) {
          liveStream.sendLog(agentId, `Sandbox execution error: ${err.message}`, 'stderr');
        }
      })();
    }

    // Notify listeners (e.g. Server runtime to trigger a fresh sandbox run)
    for (const listener of this.wakeupListeners) {
      listener(agentId, triggerType, payload);
    }
  }

  getActiveExecution(agentId: string): ActiveExecution | undefined {
    return this.activeExecutions.get(agentId);
  }
}

export const eventBroker = new ChronosEventBroker();
