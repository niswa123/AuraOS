import { pool } from './client.js';

async function testConnection() {
  console.log('Testing AuraOS Database Connection...');
  const client = await pool.connect();
  
  try {
    // 1. Basic sanity check
    const sanityCheck = await client.query('SELECT NOW() as current_time;');
    console.log(`Database connected successfully at: ${sanityCheck.rows[0].current_time}`);
    
    // 2. pgvector verification check
    const vectorCheck = await client.query("SELECT extname FROM pg_extension WHERE extname = 'vector';");
    if (vectorCheck.rows.length === 0) {
      throw new Error("pgvector extension is NOT installed or enabled on this database.");
    }
    console.log('pgvector extension is enabled and verified.');
    
    // Begin transaction for safe testing
    await client.query('BEGIN;');
    
    // 3. Test insert agent
    console.log('Inserting test agent...');
    const agentRes = await client.query(
      "INSERT INTO agents (name, configuration) VALUES ($1, $2) RETURNING id;",
      ['Test Observer Agent', JSON.stringify({ version: '1.0.0', verbose: true })]
    );
    const agentId = agentRes.rows[0].id;
    console.log(`Agent inserted with ID: ${agentId}`);
    
    // 4. Test insert vector memory (dimension 1536)
    console.log('Inserting test memories with embeddings...');
    
    // Generate dummy embeddings: 1536 values
    const emb1 = Array(1536).fill(0);
    emb1[0] = 1.0; // dominant direction 1
    
    const emb2 = Array(1536).fill(0);
    emb2[1] = 1.0; // dominant direction 2 (orthogonal)
    
    await client.query(
      "INSERT INTO vector_memories (agent_id, content, embedding) VALUES ($1, $2, $3);",
      [agentId, 'Memory A: WebAssembly execution sandbox setup', `[${emb1.join(',')}]`]
    );
    
    await client.query(
      "INSERT INTO vector_memories (agent_id, content, embedding) VALUES ($1, $2, $3);",
      [agentId, 'Memory B: Database connection pool implementation', `[${emb2.join(',')}]`]
    );
    
    // 5. Test Cosine Similarity Query
    console.log('Testing similarity lookup...');
    const queryEmb = Array(1536).fill(0);
    queryEmb[0] = 0.9;
    queryEmb[1] = 0.1; // Closer to Memory A than Memory B
    
    const similarityResult = await client.query(
      `SELECT content, (embedding <=> $1) as distance 
       FROM vector_memories 
       WHERE agent_id = $2 
       ORDER BY embedding <=> $1 
       LIMIT 1;`,
      [`[${queryEmb.join(',')}]`, agentId]
    );
    
    const closestMemory = similarityResult.rows[0];
    console.log(`Query embedding matches: "${closestMemory.content}" (distance: ${closestMemory.distance})`);
    
    // Rollback test changes to keep clean database state
    await client.query('ROLLBACK;');
    console.log('Database transactional integrity test PASSED (transactions rolled back successfully).');
    
  } catch (error) {
    console.error('Database connection test FAILED:', error);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

testConnection();
