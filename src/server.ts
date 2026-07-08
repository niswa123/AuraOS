import dotenv from 'dotenv';
import { db } from './core/db/client.js';

dotenv.config();

const PORT = process.env.PORT || 8080;

async function startServer() {
  console.log('AuraOS Agentic Runtime Environment starting up...');
  
  try {
    // Quick DB check
    const dbRes = await db.query('SELECT NOW() as db_time;');
    console.log(`Database connected. Current DB time: ${dbRes.rows[0].db_time}`);
    console.log(`AuraOS Server running on port ${PORT}`);
  } catch (error) {
    console.error('Error starting AuraOS Server:', error);
  }
}

startServer();
