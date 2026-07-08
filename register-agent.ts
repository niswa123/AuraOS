/**
 * AuraOS Agent Registration CLI Tool
 * Allows developers to register custom agents with specific code scripts
 * directly into the runtime PostgreSQL database.
 */

import { db, pool } from './src/core/db/client.js';

async function register() {
  const args = process.argv.slice(2);
  
  if (args.length < 3) {
    console.log('AuraOS Agent Registration CLI');
    console.log('Usage:');
    console.log('  npx tsx register-agent.ts <name> <runtime: python|node> <code>');
    console.log('\nExample:');
    console.log('  npx tsx register-agent.ts "Custom Scraper" python "import time\\nprint(\'Scraping target...\')\\ntime.sleep(1.5)\\nprint(\'Saved 10 records.\')"');
    process.exit(1);
  }

  const name = args[0];
  const runtime = args[1] as 'python' | 'node';
  const code = args[2];

  if (runtime !== 'python' && runtime !== 'node') {
    console.error('Error: Runtime must be either "python" or "node"');
    process.exit(1);
  }

  try {
    // 1. Insert the new agent record with custom configuration code
    const config = { runtime, code };
    
    const agentRes = await db.query(
      'INSERT INTO agents (name, configuration) VALUES ($1, $2) RETURNING id',
      [name, JSON.stringify(config)]
    );
    const agentId = agentRes.rows[0].id;

    // 2. Create the initial execution status
    const execRes = await db.query(
      'INSERT INTO executions (agent_id, status) VALUES ($1, $2) RETURNING id',
      [agentId, 'sleeping']
    );
    const execId = execRes.rows[0].id;

    // 3. Create initial state variables
    const initVariables = {
      registered_at: new Date().toISOString(),
      custom_runtime: runtime,
      runs_completed: 0
    };
    
    await db.query(
      'INSERT INTO states (agent_id, execution_id, variables, memory_snapshot) VALUES ($1, $2, $3, $4)',
      [agentId, execId, initVariables, { event: 'registration_init' }]
    );

    console.log('='.repeat(70));
    console.log(`🚀 Agent "${name}" registered successfully!`);
    console.log(`   Agent ID:    ${agentId}`);
    console.log(`   Runtime:     ${runtime}`);
    console.log('='.repeat(70));
    console.log('\nHow to test:');
    console.log('1. Keep your Developer Dashboard open at: http://localhost:5173/');
    console.log('2. Wake up the agent by running this curl command in your terminal:');
    console.log(`\n   curl -X POST http://localhost:8081/webhook/${agentId}\n`);
    console.log('3. Watch the dashboard: it will automatically focus on your new agent,');
    console.log('   execute your custom script inside the Docker container, and stream logs!');
    console.log('='.repeat(70));

  } catch (err: any) {
    console.error('Error registering agent:', err.message);
  } finally {
    await pool.end();
  }
}

register();
