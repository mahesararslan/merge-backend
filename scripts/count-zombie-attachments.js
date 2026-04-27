// One-shot count of conversation_attachments rows that never finished
// extraction (no Flow 1 context AND not in vector DB). Read-only.
require('dotenv').config();
const { Client } = require('pg');

(async () => {
  const client = new Client({ connectionString: process.env.DB_URL });
  await client.connect();
  try {
    const total = await client.query(
      `SELECT COUNT(*)::int AS c FROM conversation_attachments`,
    );
    const zombies = await client.query(
      `SELECT COUNT(*)::int AS c
         FROM conversation_attachments
        WHERE context IS NULL AND "inVectorDB" = false`,
    );
    const sample = await client.query(
      `SELECT id, "originalName", "createdAt"
         FROM conversation_attachments
        WHERE context IS NULL AND "inVectorDB" = false
        ORDER BY "createdAt" DESC
        LIMIT 10`,
    );
    console.log(`Total rows:        ${total.rows[0].c}`);
    console.log(`Zombie rows:       ${zombies.rows[0].c}`);
    console.log(`Sample (latest 10):`);
    for (const r of sample.rows) {
      console.log(`  ${r.id}  ${r.createdAt.toISOString()}  ${r.originalName}`);
    }
  } finally {
    await client.end();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
