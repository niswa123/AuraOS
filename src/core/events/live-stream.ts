/**
 * AuraOS Live Stream WebSocket Event Broadcaster
 * Handles real-time event streaming of container logs, statuses,
 * and state transitions from backend to the dashboard.
 */

import { WebSocketServer, WebSocket } from 'ws';

export interface LiveEvent {
  type: 'status_change' | 'log' | 'state_change' | 'timeline_transition';
  agentId: string;
  timestamp: string;
  payload: Record<string, unknown>;
}

class LiveStreamBroadcaster {
  private wss: WebSocketServer | null = null;
  private clients = new Set<WebSocket>();

  start(port: number = 8085): void {
    if (this.wss) return;

    this.wss = new WebSocketServer({ port });
    console.log(`[Live Stream] WebSocket server listening on port ${port}`);

    this.wss.on('connection', (ws) => {
      this.clients.add(ws);
      console.log(`[Live Stream] Dashboard client connected (${this.clients.size} active clients)`);

      // Send initial welcome message
      ws.send(JSON.stringify({
        type: 'system',
        message: 'Connected to AuraOS Live Stream Broadcaster',
        timestamp: new Date().toISOString()
      }));

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
