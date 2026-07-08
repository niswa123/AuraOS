import { pool } from './client.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runMigration() {
  console.log('Starting AuraOS database migration...');
  
  const client = await pool.connect();
  try {
    const schemaPath = path.join(__dirname, 'schema.sql');
    if (!fs.existsSync(schemaPath)) {
      throw new Error(`Schema file not found at path: ${schemaPath}`);
    }
    
    const sql = fs.readFileSync(schemaPath, 'utf8');
    
    console.log('Applying database schema and enabling pgvector...');
    await client.query(sql);
    
    console.log('Database migrations completed successfully!');
  } catch (error) {
    console.error('Database migration failed:', error);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

runMigration();
