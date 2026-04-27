// Delete conversation_attachments rows that never finished extraction
// (no Flow 1 context AND not in vector DB). Run once after the
// finalizeAttachmentRow + delete-on-failure fix has shipped — going
// forward, no new zombies will be created.
require('dotenv').config();
const { Client } = require('pg');

(async () => {
  const client = new Client({ connectionString: process.env.DB_URL });
  await client.connect();
  try {
    const before = await client.query(
      `SELECT COUNT(*)::int AS c FROM conversation_attachments
        WHERE context IS NULL AND "inVectorDB" = false`,
    );
    console.log(`Zombies before delete: ${before.rows[0].c}`);

    const res = await client.query(
      `DELETE FROM conversation_attachments
        WHERE context IS NULL AND "inVectorDB" = false
       RETURNING id`,
    );
    console.log(`Deleted: ${res.rowCount}`);
  } finally {
    await client.end();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
