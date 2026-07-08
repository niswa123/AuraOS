/**
 * AuraOS Database Seeder
 * Populates the local database with real agent and execution records
 * so the Developer Dashboard displays real-time database state immediately.
 */

import { db, pool } from './client.js';

async function seed() {
  console.log('[Database Seeder] Checking existing agents...');
  
  const check = await db.query('SELECT COUNT(*)::int as total FROM agents');
  const total = check.rows[0]?.total || 0;

  if (total > 0) {
    console.log(`[Database Seeder] Database already contains ${total} agents. Skipping seed.`);
    await pool.end();
    return;
  }

  console.log('[Database Seeder] Seeding real agent entities to PostgreSQL...');

  // 1. Insert Agents
  const agents = [
    {
      name: 'Observability Sentry',
      config: { runtime: 'python', version: '1.2.0', check_interval: '5m' }
    },
    {
      name: 'Database Sync Scheduler',
      config: { runtime: 'node', version: '2.1.0', max_pool_connections: 100 }
    },
    {
      name: 'Task Billing Worker',
      config: { runtime: 'python', version: '0.9.5', batch_size: 50 }
    }
  ];

  for (const agent of agents) {
    const agentRes = await db.query(
      'INSERT INTO agents (name, configuration) VALUES ($1, $2) RETURNING id',
      [agent.name, JSON.stringify(agent.config)]
    );
    const agentId = agentRes.rows[0].id;

    // 2. Create initial execution status for each agent
    const initialStatus = agent.name === 'Database Sync Scheduler' ? 'running' : 'sleeping';
    
    const execRes = await db.query(
      'INSERT INTO executions (agent_id, status) VALUES ($1, $2) RETURNING id',
      [agentId, initialStatus]
    );
    const execId = execRes.rows[0].id;

    // 3. Create initial state snapshot with some mock variables
    let variables = {};
    if (agent.name === 'Database Sync Scheduler') {
      variables = { db_port: 5433, active_connections: 12, pool_state: 'healthy' };
    } else if (agent.name === 'Observability Sentry') {
      variables = { last_scraped_timestamp: new Date().toISOString(), alert_threshold_pct: 90 };
    } else {
      variables = { pending_invoice_count: 5, processing_status: 'idle' };
    }

    await db.query(
      'INSERT INTO states (agent_id, execution_id, variables, memory_snapshot) VALUES ($1, $2, $3, $4)',
      [agentId, execId, variables, { event: 'seed_init' }]
    );
  }

  console.log('[Database Seeder] Database seed completed successfully.');
  await pool.end();
}

seed().catch(console.error);
