/**
 * AuraOS Chronos Trigger System - Webhook Trigger Listener
 * Starts a lightweight native HTTP server to handle incoming webhook signals.
 */

import http from 'http';
import { eventBroker } from './event-broker.js';

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

        // Parse path: expectation is /webhook/:agentId
        const match = url.match(/^\/webhook\/([a-zA-Z0-9-]+)$/);

        if (match && (method === 'POST' || method === 'GET')) {
          const agentId = match[1];
          let body = '';

          req.on('data', chunk => {
            body += chunk.toString();
          });

          req.on('end', async () => {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            
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

              res.end(JSON.stringify({
                success: true,
                message: `Wakeup event dispatched for agent ${agentId}`,
                agentId,
                timestamp: new Date().toISOString()
              }));
            } catch (error: any) {
              console.error(`[Webhook Listener] Error triggering agent ${agentId}:`, error);
              res.writeHead(500, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({
                success: false,
                error: error.message
              }));
            }
          });
        } else {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: false,
            error: 'Not Found. Use POST /webhook/:agentId'
          }));
        }
      });

      this.server.on('error', (err) => {
        reject(err);
      });

      this.server.listen(this.port, () => {
        console.log(`[Webhook Listener] HTTP webhook server listening on port ${this.port}`);
        resolve();
      });
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          console.log('[Webhook Listener] Webhook server stopped.');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }
}

export const webhookListener = new WebhookListener();
