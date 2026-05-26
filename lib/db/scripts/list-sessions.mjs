import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL not set"); process.exit(1); }

const pool = new pg.Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });
try {
  const { rows } = await pool.query(`
    SELECT
      s.id,
      s.title,
      s.mode,
      s.status,
      s.created_at,
      s.transcript_count,
      u.username,
      (SELECT COUNT(*) FROM transcripts t WHERE t.session_id = s.id) AS real_transcript_count,
      (SELECT length(string_agg(t.text, ' ')) FROM transcripts t WHERE t.session_id = s.id) AS total_chars
    FROM sessions s
    LEFT JOIN users u ON u.id = s.user_id
    ORDER BY s.created_at DESC
    LIMIT 40
  `);

  console.log(`Found ${rows.length} sessions (most recent first):\n`);
  for (const r of rows) {
    const dt = r.created_at.toISOString().slice(0, 16).replace("T", " ");
    const chars = r.total_chars ?? 0;
    console.log(`#${String(r.id).padEnd(4)} ${dt}  user=${(r.username ?? "?").padEnd(8)} ${r.mode?.padEnd(8) ?? "?".padEnd(8)} ${r.status.padEnd(8)} rows=${String(r.real_transcript_count).padEnd(4)} chars=${String(chars).padEnd(6)} "${r.title}"`);
  }
} catch (err) {
  console.error("Failed:", err.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
