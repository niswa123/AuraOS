import dotenv from 'dotenv';
import { db } from './core/db/client.js';
import { liveStream } from './core/events/live-stream.js';
import { webhookListener } from './core/scheduler/webhook-listener.js';

dotenv.config();

const PORT = process.env.PORT || 8080;

async function startServer() {
  console.log('AuraOS Agentic Runtime Environment starting up...');
  
  try {
    // 1. Verify DB connection
    const dbRes = await db.query('SELECT NOW() as db_time;');
    console.log(`[AuraOS Server] Database connected. DB time: ${dbRes.rows[0].db_time}`);

    // 2. Start Live Stream WebSocket Server (port 8085)
    liveStream.start(8085);

    // 3. Start Webhook Trigger HTTP Listener (port 8081)
    await webhookListener.start();
    
    console.log(`[AuraOS Server] Core systems online. Ready to execute cognitive workloads.`);
  } catch (error) {
    console.error('Error starting AuraOS Server:', error);
    process.exit(1);
  }
}

startServer();
