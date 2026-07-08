import http from 'http';
import net from 'net';
import { URL } from 'url';
import { db } from '../db/client.js';
import { liveStream } from '../events/live-stream.js';

const ALLOWED_DOMAINS = [
  'api.openai.com',
  'api.anthropic.com',
  'api.cohere.ai',
  'api.groq.com',
  'github.com',
  'registry.npmjs.org',
  'pypi.org',
  'files.pythonhosted.org'
];

/**
 * Generates a deterministic 1536-dimensional float vector for local semantic checks.
 */
export function generateEmbedding(text: string): number[] {
  const vector = new Array(1536).fill(0);
  for (let i = 0; i < text.length; i++) {
    const charCode = text.charCodeAt(i);
    // Position-independent mapping to ensure substring matches yield high similarity
    const index = (charCode * 31) % 1536;
    vector[index] += 1;
  }
  let sumSq = 0;
  for (const val of vector) sumSq += val * val;
  const magnitude = Math.sqrt(sumSq);
  if (magnitude > 0) {
    for (let i = 0; i < 1536; i++) {
      vector[i] /= magnitude;
    }
  }
  return vector;
}

export class EgressProxy {
  private server: http.Server | null = null;
  private port = 8086;

  public start(customPort?: number): Promise<void> {
    if (customPort) {
      this.port = customPort;
    }
    return new Promise((resolve) => {
      this.server = http.createServer((req, res) => {
        // Buffer HTTP proxy request body
        let bodyBuffer = Buffer.alloc(0);
        req.on('data', chunk => {
          bodyBuffer = Buffer.concat([bodyBuffer, chunk]);
        });

        req.on('end', async () => {
          try {
            const reqUrl = new URL(req.url || '');
            const hostname = reqUrl.hostname;

            // 1. Verify Domain Allowlist
            if (!this.isDomainAllowed(hostname)) {
              console.log(`[Egress Proxy] BLOCKED HTTP request to: ${hostname}`);
              res.writeHead(403, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({
                error: 'Egress Policy Blocked',
                message: `Outbound connection to ${hostname} is not allowed under AuraOS Sandbox policies.`
              }));
              return;
            }

            // 2. Intercept and Validate POST/PUT payload safety (Semantic Firewall)
            if (req.method === 'POST' || req.method === 'PUT') {
              const payload = bodyBuffer.toString('utf8');
              const isSafe = await this.validatePayloadSafety(payload);
              if (!isSafe) {
                console.log(`[Egress Proxy] BLOCKED outbound request containing sensitive data to: ${hostname}`);
                
                // Log security alert to active clients
                liveStream.sendLog('all', `[security] Blocking exfiltration pattern detected: payload cosine similarity exceeds 0.85 threshold.`, 'stderr');

                res.writeHead(403, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                  error: 'Security Policy Violation',
                  message: 'Cognitive Egress Safeguard: sensitive data leak detected.'
                }));
                return;
              }
            }

            console.log(`[Egress Proxy] ALLOWED HTTP request to: ${hostname}`);
            
            // 3. Forward request if safe
            const connector = http.request({
              hostname: reqUrl.hostname,
              port: reqUrl.port || 80,
              path: reqUrl.pathname + reqUrl.search,
              method: req.method,
              headers: req.headers
            }, (targetRes) => {
              res.writeHead(targetRes.statusCode || 200, targetRes.headers);
              targetRes.pipe(res);
            });

            // Write buffered body and end request
            connector.write(bodyBuffer);
            connector.end();

            connector.on('error', (err) => {
              res.writeHead(502);
              res.end(`Proxy error: ${err.message}`);
            });
          } catch (err: any) {
            res.writeHead(400);
            res.end(`Invalid request: ${err.message}`);
          }
        });
      });

      // HTTPS CONNECT tunnel handler
      this.server.on('connect', (req, clientSocket, head) => {
        try {
          const parts = req.url?.split(':') || [];
          const hostname = parts[0];
          const port = parseInt(parts[1] || '443');

          if (!this.isDomainAllowed(hostname)) {
            console.log(`[Egress Proxy] BLOCKED HTTPS CONNECT request to: ${hostname}`);
            clientSocket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
            clientSocket.end();
            return;
          }

          console.log(`[Egress Proxy] ALLOWED HTTPS CONNECT request to: ${hostname}`);

          const serverSocket = net.connect(port, hostname, () => {
            clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
            serverSocket.write(head);
            serverSocket.pipe(clientSocket);
            clientSocket.pipe(serverSocket);
          });

          serverSocket.on('error', () => {
            clientSocket.end();
          });
          clientSocket.on('error', () => {
            serverSocket.end();
          });
        } catch (err) {
          clientSocket.end();
        }
      });

      this.server.listen(this.port, () => {
        console.log(`[Egress Proxy] Server listening on port ${this.port} (filtering active)`);
        resolve();
      });
    });
  }

  public stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          console.log('[Egress Proxy] Server stopped.');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  private isDomainAllowed(host: string): boolean {
    if (!host) return false;
    return ALLOWED_DOMAINS.some(allowed => 
      host === allowed || host.endsWith('.' + allowed)
    );
  }

  /**
   * Performs the semantic firewall cosine similarity check using pgvector in database.
   */
  private async validatePayloadSafety(payload: string): Promise<boolean> {
    if (!payload || !payload.trim()) return true;

    try {
      const vector = generateEmbedding(payload);
      const vectorStr = `[${vector.join(',')}]`;

      const result = await db.query(`
        SELECT secret_text, 1 - (embedding <=> $1::vector) as similarity
        FROM compromised_secret_vectors
        ORDER BY embedding <=> $1::vector ASC
        LIMIT 1
      `, [vectorStr]);

      if (result.rows.length > 0) {
        const similarity = parseFloat(result.rows[0].similarity);
        console.log(`[Egress Proxy] Semantic check. Closest secret similarity: ${similarity.toFixed(4)}`);
        if (similarity > 0.85) {
          return false; // Similarity exceeds threshold - UNSAFE
        }
      }
    } catch (err: any) {
      console.error('[Egress Proxy] Error during payload safety validation:', err.message);
    }
    return true; // Default to pass on errors
  }
}

export const egressProxy = new EgressProxy();
