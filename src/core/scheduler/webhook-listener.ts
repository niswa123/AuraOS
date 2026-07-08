/**
 * AuraOS Chronos Trigger System - Webhook Trigger Listener & REST API
 * Starts a lightweight native HTTP server to handle incoming webhook signals
 * and exposes API endpoints for registering agents.
 */

import http from 'http';
import { eventBroker } from './event-broker.js';
import { db } from '../db/client.js';
import { liveStream } from '../events/live-stream.js';

export class WebhookListener {
  private server: http.Server | null = null;
  private port: number;

  constructor(port: number = 8081) {
    this.port = port;
  }

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer(async (req, res) => {
        const url = req.url || '';
        const method = req.method || 'GET';

        // 1. Handle CORS preflight options request
        if (method === 'OPTIONS') {
          res.writeHead(200, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'POST, GET, OPTIONS, PUT, DELETE',
            'Access-Control-Allow-Headers': 'Content-Type, X-AuraOS-Token',
            'Access-Control-Max-Age': '86400'
          });
          res.end();
          return;
        }

        // Helper to send JSON responses with CORS enabled
        const sendJson = (statusCode: number, data: any) => {
          res.writeHead(statusCode, {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          });
          res.end(JSON.stringify(data));
        };

        // 2. REST API Route: Register agent from UI
        if (url === '/api/agents' && method === 'POST') {
          let body = '';
          let bodySize = 0;
          const MAX_PAYLOAD_SIZE = 1 * 1024 * 1024; // 1 MB limit
          let limitExceeded = false;

          req.on('data', chunk => {
            if (limitExceeded) return;
            bodySize += chunk.length;
            if (bodySize > MAX_PAYLOAD_SIZE) {
              limitExceeded = true;
              sendJson(413, { success: false, error: 'Payload Too Large' });
              req.destroy();
            }
            body += chunk.toString();
          });

          req.on('end', async () => {
            if (limitExceeded) return;

            try {
              const { name, runtime, code } = JSON.parse(body);

              if (!name || !runtime || !code) {
                sendJson(400, { success: false, error: 'Missing name, runtime, or code.' });
                return;
              }

              if (runtime !== 'python' && runtime !== 'node') {
                sendJson(400, { success: false, error: 'Runtime must be "python" or "node".' });
                return;
              }

              // A. Save to pgsql agents
              const agentRes = await db.query(
                'INSERT INTO agents (name, configuration) VALUES ($1, $2) RETURNING id',
                [name, JSON.stringify({ runtime, code })]
              );
              const agentId = agentRes.rows[0].id;

              // B. Create execution
              const execRes = await db.query(
                'INSERT INTO executions (agent_id, status) VALUES ($1, $2) RETURNING id',
                [agentId, 'sleeping']
              );
              const execId = execRes.rows[0].id;

              // C. Create state snapshot
              await db.query(
                'INSERT INTO states (agent_id, execution_id, variables, memory_snapshot) VALUES ($1, $2, $3, $4)',
                [agentId, execId, { registered_at: new Date().toISOString(), runs_completed: 0 }, { event: 'ui_init' }]
              );

              // D. Broadcast to WS live stream
              liveStream.sendStatus(agentId, 'sleeping', name, runtime);

              sendJson(201, {
                success: true,
                agent: { id: agentId, name, runtime, status: 'sleeping', lastActive: 'never' }
              });
            } catch (err: any) {
              sendJson(500, { success: false, error: err.message });
            }
          });
          return;
        }

        // 3. REST API Route: Webhook Trigger Wakeup
        const match = url.match(/^\/webhook\/([a-zA-Z0-9-]+)$/);

        if (match && (method === 'POST' || method === 'GET')) {
          const agentId = match[1];
          let body = '';
          let bodySize = 0;
          const MAX_PAYLOAD_SIZE = 1 * 1024 * 1024; // 1 MB limit

          // Simple token authentication check if secret is configured
          const webhookSecret = process.env.WEBHOOK_SECRET;
          const requestToken = req.headers['x-auraos-token'];
          
          if (webhookSecret && requestToken !== webhookSecret) {
            sendJson(401, { success: false, error: 'Unauthorized. Invalid X-AuraOS-Token.' });
            return;
          }

          let limitExceeded = false;
          req.on('data', chunk => {
            if (limitExceeded) return;
            bodySize += chunk.length;
            if (bodySize > MAX_PAYLOAD_SIZE) {
              limitExceeded = true;
              sendJson(413, { success: false, error: 'Payload Too Large. Limit is 1MB.' });
              req.destroy();
              return;
            }
            body += chunk.toString();
          });

          req.on('end', async () => {
            if (limitExceeded) return;
            
            try {
              let parsedBody = {};
              if (body && req.headers['content-type']?.includes('application/json')) {
                parsedBody = JSON.parse(body);
              }

              console.log(`[Webhook Listener] Webhook matching agent ${agentId} triggered.`);
              
              // Wake up the agent via Event Broker
              await eventBroker.wakeup(agentId, 'webhook', {
                method,
                payload: parsedBody,
                headers: req.headers
              });

              sendJson(200, {
                success: true,
                message: `Wakeup event dispatched for agent ${agentId}`,
                agentId,
                timestamp: new Date().toISOString()
              });
            } catch (error: any) {
              console.error(`[Webhook Listener] Error triggering agent ${agentId}:`, error);
              sendJson(500, { success: false, error: error.message });
            }
          });
        } else {
          sendJson(404, { success: false, error: 'Not Found. Use POST /webhook/:agentId or POST /api/agents' });
        }
      });

      this.server.on('error', (err) => {
        reject(err);
      });

      this.server.listen(this.port, () => {
        console.log(`[Webhook Listener] HTTP server listening on port ${this.port}`);
        resolve();
      });
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          console.log('[Webhook Listener] HTTP server stopped.');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }
}

export const webhookListener = new WebhookListener();
