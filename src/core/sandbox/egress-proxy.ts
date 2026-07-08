import http from 'http';
import net from 'net';
import { URL } from 'url';

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

export class EgressProxy {
  private server: http.Server | null = null;
  private port = 8086;

  public start(): Promise<void> {
    return new Promise((resolve) => {
      this.server = http.createServer((req, res) => {
        // HTTP proxy handler
        try {
          const reqUrl = new URL(req.url || '');
          const hostname = reqUrl.hostname;

          if (!this.isDomainAllowed(hostname)) {
            console.log(`[Egress Proxy] BLOCKED HTTP request to: ${hostname}`);
            res.writeHead(403, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              error: 'Egress Policy Blocked',
              message: `Outbound connection to ${hostname} is not allowed under AuraOS Sandbox policies.`
            }));
            return;
          }

          console.log(`[Egress Proxy] ALLOWED HTTP request to: ${hostname}`);
          
          // Forward request
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

          req.pipe(connector);
          connector.on('error', (err) => {
            res.writeHead(502);
            res.end(`Proxy error: ${err.message}`);
          });
        } catch (err: any) {
          res.writeHead(400);
          res.end(`Invalid request: ${err.message}`);
        }
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
    // Check if host matches any allowed domain or its subdomains
    return ALLOWED_DOMAINS.some(allowed => 
      host === allowed || host.endsWith('.' + allowed)
    );
  }
}

export const egressProxy = new EgressProxy();
