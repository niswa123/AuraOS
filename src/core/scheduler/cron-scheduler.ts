/**
 * AuraOS Chronos Trigger System - Cron Trigger Scheduler
 * Leverages node-cron to trigger agents at specified intervals.
 */

import cron from 'node-cron';
import { eventBroker } from './event-broker.js';

class CronScheduler {
  private activeJobs = new Map<string, cron.ScheduledTask>();

  /**
   * Register a new cron trigger for an agent.
   * Stops any existing job for the same agent.
   */
  register(agentId: string, cronExpression: string): void {
    // 1. Clean up existing job
    this.stop(agentId);

    // 2. Validate cron expression
    if (!cron.validate(cronExpression)) {
      throw new Error(`Invalid cron expression: "${cronExpression}"`);
    }

    console.log(`[Cron Scheduler] Registering cron trigger for agent ${agentId}: "${cronExpression}"`);

    // 3. Create and start scheduled job
    const job = cron.schedule(cronExpression, async () => {
      console.log(`[Cron Scheduler] Cron trigger fired for agent ${agentId}`);
      try {
        await eventBroker.wakeup(agentId, 'cron');
      } catch (error) {
        console.error(`[Cron Scheduler] Failed to execute cron wakeup for agent ${agentId}:`, error);
      }
    });

    this.activeJobs.set(agentId, job);
  }

  /**
   * Stop and clean up an active cron trigger.
   */
  stop(agentId: string): void {
    const job = this.activeJobs.get(agentId);
    if (job) {
      job.stop();
      this.activeJobs.delete(agentId);
      console.log(`[Cron Scheduler] Stopped cron trigger for agent ${agentId}`);
    }
  }

  /**
   * Stop all active cron triggers.
   */
  stopAll(): void {
    for (const [agentId, job] of this.activeJobs.entries()) {
      job.stop();
      console.log(`[Cron Scheduler] Stopped cron trigger for agent ${agentId}`);
    }
    this.activeJobs.clear();
  }

  isRegistered(agentId: string): boolean {
    return this.activeJobs.has(agentId);
  }
}

export const cronScheduler = new CronScheduler();
