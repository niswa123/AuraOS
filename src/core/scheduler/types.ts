/**
 * AuraOS Chronos Trigger System - Type Definitions
 * Definitions for triggers, events, and hibernation state structures.
 */

export type TriggerType = 'webhook' | 'cron' | 'async_task';

export interface BaseTrigger {
  id: string;
  agentId: string;
  type: TriggerType;
  enabled: boolean;
  createdAt: string;
}

export interface WebhookTrigger extends BaseTrigger {
  type: 'webhook';
  endpoint: string; // The URL path suffix e.g., /webhook/agent-123
  method: 'POST' | 'GET' | 'PUT';
}

export interface CronTrigger extends BaseTrigger {
  type: 'cron';
  cronExpression: string; // Standard 5-field cron e.g., "*/5 * * * *"
}

export interface AsyncTaskTrigger extends BaseTrigger {
  type: 'async_task';
  taskId: string; // The task ID the agent is waiting for
}

export interface HibernateRequest {
  agentId: string;
  executionId: string;
  trigger: {
    type: TriggerType;
    details: {
      endpoint?: string;       // Webhook details
      method?: 'POST' | 'GET'; // Webhook details
      cronExpression?: string; // Cron details
      taskId?: string;         // AsyncTask details
    };
  };
  variables: Record<string, unknown>; // Variables to serialize before sleeping
}

export interface HibernateResponse {
  success: boolean;
  agentId: string;
  executionId: string;
  suspendedAt: string;
  status: 'sleeping';
}
