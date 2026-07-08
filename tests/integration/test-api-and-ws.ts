/**
 * AuraOS Integration Tests — REST API (CRUD) & WebSocket Live Stream
 * Requires running backend: npm run dev
 * Run: npx tsx tests/integration/test-api-and-ws.ts
 */

import http from 'http';
import { WebSocket } from 'ws';

// ─── Test harness ───
let passed = 0;
let failed = 0;
const failures: string[] = [];

function assert(condition: boolean, label: string) {
  if (condition) {
    passed++;
    console.log(`  ✅ ${label}`);
  } else {
    failed++;
    failures.push(label);
    console.log(`  ❌ ${label}`);
  }
}

function section(title: string) {
  console.log(`\n━━━ ${title} ━━━`);
}

// ─── HTTP helper ───
function httpRequest(
  method: string,
  path: string,
  body?: any
): Promise<{ status: number; data: any }> {
  return new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : undefined;
    const options: http.RequestOptions = {
      hostname: 'localhost',
      port: 8081,
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {}),
      },
    };

    const req = http.request(options, (res) => {
      let raw = '';
      res.on('data', (chunk) => (raw += chunk));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode || 0, data: JSON.parse(raw) });
        } catch {
          resolve({ status: res.statusCode || 0, data: raw });
        }
      });
    });

    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

// ─── WebSocket helper ───
function wsConnect(timeoutMs = 5000): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket('ws://localhost:8085');
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error('WS connect timeout'));
    }, timeoutMs);

    ws.on('open', () => {
      clearTimeout(timer);
      resolve(ws);
    });
    ws.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

function wsWaitForMessage(ws: WebSocket, filterFn: (data: any) => boolean, timeoutMs = 8000): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('WS message timeout')), timeoutMs);

    const handler = (raw: any) => {
      try {
        const data = JSON.parse(raw.toString());
        if (filterFn(data)) {
          clearTimeout(timer);
          ws.off('message', handler);
          resolve(data);
        }
      } catch { /* skip non-json */ }
    };

    ws.on('message', handler);
  });
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// ═══════════════════════════════════════════════════════════
//  TESTS
// ═══════════════════════════════════════════════════════════
async function runTests() {
  console.log('\n🧪 AuraOS Integration Tests — REST API & WebSocket\n');

  let createdAgentId: string | null = null;

  // ─── 1. Health check — server is reachable ───
  section('1. Server health check');
  try {
    const res = await httpRequest('GET', '/api/agents');
    assert(res.status === 200, `GET /api/agents returns 200 (got ${res.status})`);
    assert(res.data.success === true, 'Response has success: true');
    assert(Array.isArray(res.data.agents), 'Response agents is an array');
  } catch (err: any) {
    assert(false, `Server unreachable: ${err.message}`);
    console.log('\n⚠️  Backend is not running. Start it with: npm run dev\n');
    process.exit(1);
  }

  // ─── 2. WebSocket connects ───
  section('2. WebSocket connection');
  let ws: WebSocket | null = null;
  try {
    ws = await wsConnect();
    assert(ws.readyState === WebSocket.OPEN, 'WebSocket connects to port 8085');
  } catch (err: any) {
    assert(false, `WebSocket failed: ${err.message}`);
  }

  // ─── 3. WebSocket receives init_agents on connect ───
  section('3. WebSocket receives init_agents');
  if (ws) {
    try {
      // The init_agents message is sent immediately on connection,
      // but we already connected; reconnect to catch it
      ws.close();
      await sleep(300);

      ws = await wsConnect();
      const initMsg = await wsWaitForMessage(ws, (d) => d.type === 'init_agents');
      assert(initMsg.type === 'init_agents', 'Received init_agents message');
      assert(Array.isArray(initMsg.payload?.agents), 'init_agents contains agents array');
    } catch (err: any) {
      assert(false, `init_agents not received: ${err.message}`);
    }
  }

  // ─── 4. CREATE agent via POST /api/agents ───
  section('4. CREATE — POST /api/agents');
  try {
    const res = await httpRequest('POST', '/api/agents', {
      name: '__test_agent_' + Date.now(),
      runtime: 'python',
      code: 'print("AuraOS test agent")',
    });
    assert(res.status === 201, `Status 201 Created (got ${res.status})`);
    assert(res.data.success === true, 'success: true');
    assert(typeof res.data.agent?.id === 'string', 'Returns agent.id (UUID)');
    assert(res.data.agent?.runtime === 'python', 'Returns agent.runtime = python');
    assert(res.data.agent?.status === 'sleeping', 'Initial status = sleeping');

    createdAgentId = res.data.agent?.id;
  } catch (err: any) {
    assert(false, `Create failed: ${err.message}`);
  }

  // ─── 5. CREATE — validation (missing fields) ───
  section('5. CREATE — validation errors');
  try {
    const res1 = await httpRequest('POST', '/api/agents', { name: '', runtime: 'python', code: 'x' });
    assert(res1.status === 400, `Empty name → 400 (got ${res1.status})`);

    const res2 = await httpRequest('POST', '/api/agents', { name: 'X', runtime: 'ruby', code: 'x' });
    assert(res2.status === 400, `Invalid runtime "ruby" → 400 (got ${res2.status})`);

    const res3 = await httpRequest('POST', '/api/agents', { name: 'X' });
    assert(res3.status === 400, `Missing runtime + code → 400 (got ${res3.status})`);
  } catch (err: any) {
    assert(false, `Validation test failed: ${err.message}`);
  }

  // ─── 6. READ — GET /api/agents includes created agent ───
  section('6. READ — GET /api/agents');
  try {
    const res = await httpRequest('GET', '/api/agents');
    assert(res.status === 200, 'Status 200');
    const found = res.data.agents?.find((a: any) => a.id === createdAgentId);
    assert(!!found, `Created agent ${createdAgentId?.slice(0, 8)}... found in list`);
    assert(found?.runtime === 'python', 'Runtime matches');
  } catch (err: any) {
    assert(false, `Read failed: ${err.message}`);
  }

  // ─── 7. UPDATE — PUT /api/agents/:id ───
  section('7. UPDATE — PUT /api/agents/:id');
  if (createdAgentId) {
    try {
      const res = await httpRequest('PUT', `/api/agents/${createdAgentId}`, {
        name: '__test_agent_UPDATED',
        runtime: 'node',
        code: 'console.log("updated")',
      });
      assert(res.status === 200, `Status 200 (got ${res.status})`);
      assert(res.data.success === true, 'success: true');

      // Verify update persisted
      const readRes = await httpRequest('GET', '/api/agents');
      const updatedAgent = readRes.data.agents?.find((a: any) => a.id === createdAgentId);
      assert(updatedAgent?.name?.includes('UPDATED'), 'Name updated in DB');
    } catch (err: any) {
      assert(false, `Update failed: ${err.message}`);
    }
  }

  // ─── 8. UPDATE — validation (missing fields) ───
  section('8. UPDATE — validation errors');
  if (createdAgentId) {
    try {
      const res = await httpRequest('PUT', `/api/agents/${createdAgentId}`, {
        name: 'X',
        // missing runtime and code
      });
      assert(res.status === 400, `Missing fields → 400 (got ${res.status})`);
    } catch (err: any) {
      assert(false, `Update validation test failed: ${err.message}`);
    }
  }

  // ─── 9. WebSocket — agent_details request/response ───
  section('9. WebSocket — get_agent_details');
  if (ws && ws.readyState === WebSocket.OPEN && createdAgentId) {
    try {
      const detailsPromise = wsWaitForMessage(ws, (d) => d.type === 'agent_details' && d.agentId === createdAgentId);
      ws.send(JSON.stringify({ action: 'get_agent_details', agentId: createdAgentId }));
      const details = await detailsPromise;

      assert(details.type === 'agent_details', 'Received agent_details');
      assert(details.agentId === createdAgentId, 'agentId matches');
      assert(typeof details.payload?.code === 'string', 'Payload contains code');
      assert(typeof details.payload?.runtime === 'string', 'Payload contains runtime');
    } catch (err: any) {
      assert(false, `agent_details failed: ${err.message}`);
    }
  }

  // ─── 10. Webhook trigger endpoint ───
  section('10. Webhook trigger — POST /webhook/:id');
  if (createdAgentId) {
    try {
      const res = await httpRequest('POST', `/webhook/${createdAgentId}`, {
        triggered_by: 'integration_test',
      });
      // Should return 200 (wakeup dispatched) even if sandbox fails
      assert(res.status === 200, `Status 200 (got ${res.status})`);
      assert(res.data.success === true, 'success: true');
      assert(res.data.agentId === createdAgentId, 'agentId matches');
    } catch (err: any) {
      assert(false, `Webhook trigger failed: ${err.message}`);
    }
  }

  // ─── 11. Webhook with auth token (when WEBHOOK_SECRET is not set, should pass) ───
  section('11. Webhook — token auth (no secret configured)');
  if (createdAgentId) {
    try {
      const res = await httpRequest('POST', `/webhook/${createdAgentId}`, {});
      assert(res.status === 200, `No secret → 200 (got ${res.status})`);
    } catch (err: any) {
      assert(false, `Webhook auth test failed: ${err.message}`);
    }
  }

  // ─── 12. Database change webhook ───
  section('12. Database change — POST /webhook/db-change');
  try {
    const res = await httpRequest('POST', '/webhook/db-change', {
      table: 'users',
      type: 'INSERT',
      record: { id: 1, name: 'test' },
    });
    // Should return 200 if agents exist, or 404 if none
    assert(res.status === 200 || res.status === 404, `Status 200 or 404 (got ${res.status})`);
    assert(typeof res.data.success === 'boolean', 'Returns success boolean');
  } catch (err: any) {
    assert(false, `DB change webhook failed: ${err.message}`);
  }

  // ─── 13. 404 for unknown routes ───
  section('13. Unknown route → 404');
  try {
    const res = await httpRequest('GET', '/nonexistent');
    assert(res.status === 404, `Status 404 (got ${res.status})`);
  } catch (err: any) {
    assert(false, `404 test failed: ${err.message}`);
  }

  // ─── 14. CORS preflight ───
  section('14. CORS — OPTIONS preflight');
  try {
    const res = await httpRequest('OPTIONS', '/api/agents');
    assert(res.status === 200, `OPTIONS returns 200 (got ${res.status})`);
  } catch (err: any) {
    assert(false, `CORS test failed: ${err.message}`);
  }

  // Wait a moment for sandbox/wakeup background processes to settle
  await sleep(2000);

  // ─── 15. DELETE — DELETE /api/agents/:id ───
  section('15. DELETE — DELETE /api/agents/:id');
  if (createdAgentId) {
    try {
      const res = await httpRequest('DELETE', `/api/agents/${createdAgentId}`);
      assert(res.status === 200, `Status 200 (got ${res.status})`);
      assert(res.data.success === true, 'success: true');

      // Verify deletion persisted
      await sleep(500);
      const readRes = await httpRequest('GET', '/api/agents');
      const deleted = readRes.data.agents?.find((a: any) => a.id === createdAgentId);
      assert(!deleted, `Agent ${createdAgentId?.slice(0, 8)}... no longer in list`);
    } catch (err: any) {
      assert(false, `Delete failed: ${err.message}`);
    }
  }

  // ─── 16. DELETE — idempotent (delete non-existent) ───
  section('16. DELETE — non-existent agent');
  try {
    const res = await httpRequest('DELETE', '/api/agents/00000000-0000-0000-0000-000000000000');
    // Should still return 200 (idempotent) since DELETE WHERE doesn't error on zero rows
    assert(res.status === 200, `Idempotent delete → 200 (got ${res.status})`);
  } catch (err: any) {
    assert(false, `Idempotent delete test failed: ${err.message}`);
  }

  // ─── Cleanup ───
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.close();
  }

  // ═══════════════════════════════════════════════════════════
  //  Summary
  // ═══════════════════════════════════════════════════════════
  console.log('\n' + '═'.repeat(50));
  console.log(`  Total: ${passed + failed} | ✅ Passed: ${passed} | ❌ Failed: ${failed}`);

  if (failures.length > 0) {
    console.log('\n  Failed tests:');
    failures.forEach((f) => console.log(`    • ${f}`));
  }

  console.log('═'.repeat(50) + '\n');
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
