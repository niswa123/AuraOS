/**
 * AuraOS Live Stream WebSocket Event Broadcaster
 * Handles real-time event streaming of container logs, statuses,
 * and state transitions from backend to the dashboard.
 */

import { WebSocketServer, WebSocket } from 'ws';
import { db } from '../db/client.js';

export interface LiveEvent {
  type: 'status_change' | 'log' | 'state_change' | 'timeline_transition' | 'init_agents' | 'agent_details' | 'billing_metrics';
  agentId: string;
  timestamp: string;
  payload: Record<string, unknown>;
}

function formatTimeAgo(dateStr: string): string {
  const date = new Date(dateStr);
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 5) return 'Active now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

class LiveStreamBroadcaster {
  private wss: WebSocketServer | null = null;
  private clients = new Set<WebSocket>();

  start(port: number = 8085): void {
    if (this.wss) return;

    this.wss = new WebSocketServer({ port });
    console.log(`[Live Stream] WebSocket server listening on port ${port}`);

    this.wss.on('connection', async (ws) => {
      this.clients.add(ws);
      console.log(`[Live Stream] Dashboard client connected (${this.clients.size} active clients)`);

      // 1. Send initial welcome message
      ws.send(JSON.stringify({
        type: 'system',
        message: 'Connected to AuraOS Live Stream Broadcaster',
        timestamp: new Date().toISOString()
      }));

      // 2. Query database for all agents and their latest execution statuses
      try {
        const result = await db.query(`
          SELECT 
            a.id, 
            a.name, 
            a.configuration->>'runtime' as runtime,
            COALESCE(e.status, 'sleeping') as status,
            e.updated_at
          FROM agents a
          LEFT JOIN LATERAL (
            SELECT status, updated_at 
            FROM executions 
            WHERE agent_id = a.id 
            ORDER BY created_at DESC 
            LIMIT 1
          ) e ON true
          ORDER BY a.name ASC
        `);

        ws.send(JSON.stringify({
          type: 'init_agents',
          agentId: 'system',
          timestamp: new Date().toISOString(),
          payload: {
            agents: result.rows.map(row => ({
              id: row.id,
              name: row.name,
              runtime: row.runtime || 'python',
              status: row.status,
              lastActive: row.updated_at ? formatTimeAgo(row.updated_at.toISOString()) : 'never'
            }))
          }
        }));
      } catch (err) {
        console.error('[Live Stream] Error sending initial agents list:', err);
      }

      // 3. Listen for client requests (e.g. request details/variables of selected agent)
      ws.on('message', async (message) => {
        try {
          const raw = message.toString();
          const data = JSON.parse(raw);

          if (data.action === 'get_agent_details' && data.agentId) {
            const agentId = data.agentId;

            // A. Fetch latest variables from states
            const stateRes = await db.query(
              `SELECT variables, memory_snapshot, created_at 
               FROM states 
               WHERE agent_id = $1 
               ORDER BY created_at DESC 
               LIMIT 1`,
              [agentId]
            );

            const variables = stateRes.rows[0]?.variables || {};
            const memorySnapshot = stateRes.rows[0]?.memory_snapshot || {};
            
            // Map status timeline stage
            const timelineStage = memorySnapshot.triggerType === 'cron' 
              ? 'Sleep' 
              : memorySnapshot.triggerType === 'webhook' 
              ? 'Hibernate' 
              : 'Sleep';

            // B. Fetch configuration and code from agents
            const agentRes = await db.query(
              `SELECT name, configuration FROM agents WHERE id = $1`,
              [agentId]
            );
            const agent = agentRes.rows[0];
            const config = agent?.configuration || {};
            const code = config.code || '';
            const runtime = config.runtime || 'python';

            ws.send(JSON.stringify({
              type: 'agent_details',
              agentId,
              timestamp: new Date().toISOString(),
              payload: {
                variables,
                timelineStage,
                code,
                runtime
              }
            }));
          }
        } catch (err) {
          console.error('[Live Stream] Error handling client message:', err);
        }
      });

      ws.on('close', () => {
        this.clients.delete(ws);
        console.log('[Live Stream] Dashboard client disconnected');
      });

      ws.on('error', (err) => {
        console.error('[Live Stream] Client socket error:', err);
        this.clients.delete(ws);
      });
    });
  }

  /**
   * Broadcast an event to all connected dashboard clients.
   */
  broadcast(event: LiveEvent): void {
    const data = JSON.stringify(event);
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    }
  }

  /**
   * Broadcast a sandbox or agent execution log stream.
   */
  sendLog(agentId: string, message: string, stream: 'stdout' | 'stderr' | 'system'): void {
    this.broadcast({
      type: 'log',
      agentId,
      timestamp: new Date().toISOString(),
      payload: { message, stream }
    });
  }

  /**
   * Broadcast container or agent status modifications.
   */
  sendStatus(
    agentId: string, 
    status: 'running' | 'hibernating' | 'sleeping' | 'completed' | 'failed',
    name?: string,
    runtime?: 'python' | 'node'
  ) {
    this.broadcast({
      type: 'status_change',
      agentId,
      timestamp: new Date().toISOString(),
      payload: { status, name, runtime }
    });
  }

  /**
   * Broadcast variable changes or inspector state updates.
   */
  sendStateUpdate(agentId: string, variables: Record<string, unknown>) {
    this.broadcast({
      type: 'state_change',
      agentId,
      timestamp: new Date().toISOString(),
      payload: { variables }
    });
  }

  /**
   * Broadcast timeline stage transition events.
   */
  sendTimelineTransition(agentId: string, stage: 'Trigger' | 'Active' | 'Hibernate' | 'Sleep') {
    this.broadcast({
      type: 'timeline_transition',
      agentId,
      timestamp: new Date().toISOString(),
      payload: { stage }
    });
  }

  /**
   * Broadcast real-time execution usage and billing metrics.
   */
  sendBillingMetrics(agentId: string, durationMs: number, ramAllocatedMb: number, costUsd: number) {
    this.broadcast({
      type: 'billing_metrics',
      agentId,
      timestamp: new Date().toISOString(),
      payload: { durationMs, ramAllocatedMb, costUsd }
    });
  }

  stop(): void {
    if (this.wss) {
      this.wss.close();
      this.wss = null;
      this.clients.clear();
      console.log('[Live Stream] WebSocket server stopped.');
    }
  }
}

export const liveStream = new LiveStreamBroadcaster();
