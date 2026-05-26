import pg from "pg";

const ids = process.argv.slice(2).map((s) => Number(s)).filter((n) => Number.isInteger(n));
if (ids.length === 0) { console.error("Usage: node dump-session.mjs <id> [<id> ...]"); process.exit(1); }

const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL not set"); process.exit(1); }

const pool = new pg.Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });
try {
  for (const id of ids) {
    const { rows: sRows } = await pool.query(`SELECT id, title, mode, status, created_at FROM sessions WHERE id = $1`, [id]);
    if (sRows.length === 0) { console.log(`\nSession #${id} — not found\n`); continue; }
    const s = sRows[0];
    console.log("═".repeat(72));
    console.log(`Session #${s.id}  "${s.title}"  mode=${s.mode}  status=${s.status}  created=${s.created_at.toISOString().slice(0, 19).replace("T", " ")}`);
    console.log("═".repeat(72));
    const { rows: tRows } = await pool.query(`SELECT speaker_label, text, start_ms FROM transcripts WHERE session_id = $1 ORDER BY start_ms ASC`, [id]);
    if (tRows.length === 0) { console.log("(no transcripts)"); continue; }
    for (const t of tRows) {
      const sec = Math.floor(t.start_ms / 1000);
      const m = Math.floor(sec / 60);
      const ss = sec % 60;
      console.log(`[${m}:${ss.toString().padStart(2, "0")}  ${t.speaker_label}]`);
      console.log(`  ${t.text.replace(/\s+/g, " ").trim()}`);
      console.log();
    }
  }
} catch (err) {
  console.error("Failed:", err.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
