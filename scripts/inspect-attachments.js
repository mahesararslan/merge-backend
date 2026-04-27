// Inspect recent conversations and their attachment state.
require('dotenv').config();
const { Client } = require('pg');

(async () => {
  const client = new Client({ connectionString: process.env.DB_URL });
  await client.connect();
  try {
    const r = await client.query(`
      SELECT
        c.id AS conv_id,
        c.title,
        c."updatedAt" AS conv_updated,
        a.id AS att_id,
        a."originalName",
        a."createdAt" AS att_created,
        (a.context IS NOT NULL) AS has_context,
        COALESCE(LENGTH(a.context), 0) AS ctx_len,
        a."inVectorDB"
      FROM ai_conversations c
      LEFT JOIN conversation_attachments a ON a."conversationId" = c.id
      WHERE c."updatedAt" > NOW() - INTERVAL '1 day'
      ORDER BY c."updatedAt" DESC, a."createdAt" ASC
      LIMIT 40
    `);
    let lastConv = null;
    for (const row of r.rows) {
      if (row.conv_id !== lastConv) {
        console.log(`\n${row.conv_updated.toISOString()}  [${row.conv_id.slice(0, 8)}] ${row.title}`);
        lastConv = row.conv_id;
      }
      if (row.att_id) {
        console.log(
          `  - ${row.att_created.toISOString()}  ` +
          `ctx=${row.has_context ? row.ctx_len + 'ch' : 'NULL'}  ` +
          `vdb=${row.inVectorDB}  ` +
          `${row.originalName}`,
        );
      } else {
        console.log(`  (no attachments)`);
      }
    }
  } finally {
    await client.end();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
