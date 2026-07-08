/**
 * AuraOS Chronos Trigger System - Event Broker
 * Handles agent hibernation state transitions, sandbox teardowns,
 * and event-driven wakeups.
 */

import { serializeState, hydrateState } from '../memory/state-engine.js';
import { db } from '../db/client.js';
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

    if (active) {
      active.status = 'running';
    }

    console.log(`[Chronos Broker] Agent ${agentId} hydrated. Context variables:`, JSON.stringify(stateRes.state.variables));

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
