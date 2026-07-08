/**
 * AuraOS Chronos Trigger System - Webhook Trigger Listener & REST API
 * Starts a lightweight native HTTP server to handle incoming webhook signals
 * and exposes API endpoints for registering agents.
 */

import http from 'http';
import { eventBroker } from './event-broker.js';
import { db } from '../db/client.js';
import { liveStream } from '../events/live-stream.js';
import { executeInSandbox } from '../sandbox/orchestrator.js';

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

        // Ad-hoc Sandbox Execution Endpoint (for SDK runs)
        if (url === '/api/sandboxes' && method === 'POST') {
          let body = '';
          req.on('data', chunk => {
            body += chunk.toString();
          });
          req.on('end', async () => {
            try {
              const { runtime, code, env, limits } = JSON.parse(body);
              if (!runtime || !code) {
                sendJson(400, { success: false, error: 'Missing runtime or code.' });
                return;
              }
              if (runtime !== 'python' && runtime !== 'node') {
                sendJson(400, { success: false, error: 'Runtime must be "python" or "node".' });
                return;
              }

              const executionId = `sdk-${Date.now().toString().slice(-6)}`;
              const result = await executeInSandbox({
                executionId,
                runtime,
                code,
                limits: {
                  memoryBytes: limits?.memoryBytes || 128 * 1024 * 1024,
                  cpuCores: limits?.cpuCores || 0.5,
                  timeoutMs: limits?.timeoutMs || 15000,
                  pidsLimit: limits?.pidsLimit || 32,
                  networkDisabled: limits?.networkDisabled ?? false
                },
                env
              });

              sendJson(200, {
                success: true,
                executionId: result.executionId,
                exitCode: result.exitCode,
                stdout: result.stdout,
                stderr: result.stderr,
                durationMs: result.durationMs,
                timedOut: result.timedOut,
                oomKilled: result.oomKilled,
                checkpointVars: result.checkpointVars
              });
            } catch (err: any) {
              sendJson(500, { success: false, error: err.message });
            }
          });
          return;
        }

        // 2. REST API Route: List all agents (Read)
        if (url === '/api/agents' && method === 'GET') {
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
            sendJson(200, {
              success: true,
              agents: result.rows.map(row => ({
                id: row.id,
                name: row.name,
                runtime: row.runtime || 'python',
                status: row.status,
                lastActive: row.updated_at ? row.updated_at.toISOString() : 'never'
              }))
            });
          } catch (err: any) {
            sendJson(500, { success: false, error: err.message });
          }
          return;
        }

        // 3. REST API Route: Register agent from UI (Create)
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

        // 4. REST API Routes: Update & Delete Agents (PUT / DELETE)
        const agentApiMatch = url.match(/^\/api\/agents\/([a-zA-Z0-9-]+)$/);
        if (agentApiMatch) {
          const agentId = agentApiMatch[1];

          if (method === 'PUT') {
            let body = '';
            req.on('data', chunk => {
              body += chunk.toString();
            });

            req.on('end', async () => {
              try {
                const { name, runtime, code } = JSON.parse(body);

                if (!name || !runtime || !code) {
                  sendJson(400, { success: false, error: 'Missing name, runtime, or code.' });
                  return;
                }

                await db.query(
                  "UPDATE agents SET name = $1, configuration = $2, updated_at = NOW() WHERE id = $3",
                  [name, JSON.stringify({ runtime, code }), agentId]
                );

                // Broadcast update
                liveStream.sendStatus(agentId, 'sleeping', name, runtime);

                sendJson(200, { success: true, message: 'Agent updated successfully.' });
              } catch (err: any) {
                sendJson(500, { success: false, error: err.message });
              }
            });
            return;
          }

          if (method === 'DELETE') {
            try {
              // Deleting agent CASCADE deletes all executions and states in DB
              await db.query("DELETE FROM agents WHERE id = $1", [agentId]);

              // Broadcast deletion to all open UI dashboards
              liveStream.sendStatus(agentId, 'deleted');

              sendJson(200, { success: true, message: 'Agent deleted successfully.' });
            } catch (err: any) {
              sendJson(500, { success: false, error: err.message });
            }
            return;
          }
        }

        // 5. REST API Route: Database change event listener (Supabase Webhook mock)
        if (url === '/webhook/db-change' && method === 'POST') {
          let body = '';
          req.on('data', chunk => {
            body += chunk.toString();
          });
          req.on('end', async () => {
            try {
              const payload = JSON.parse(body);
              console.log('[Webhook Listener] DB Change event captured:', payload);
              
              // Route to the first registered agent in database
              const agentRes = await db.query('SELECT id, name FROM agents LIMIT 1');
              if (agentRes.rows.length > 0) {
                const targetAgent = agentRes.rows[0];
                console.log(`[Webhook Listener] Routing DB event to agent "${targetAgent.name}" (${targetAgent.id})`);
                await eventBroker.wakeup(targetAgent.id, 'db-change', payload);
                sendJson(200, { success: true, routedToAgent: targetAgent.name });
              } else {
                sendJson(404, { success: false, error: 'No agents registered to route database change event.' });
              }
            } catch (err: any) {
              sendJson(500, { success: false, error: err.message });
            }
          });
          return;
        }

        // 6. REST API Route: Webhook Trigger Wakeup
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
