// Quick search across all transcripts for given keywords. Returns
// sessions that contain any hit, with the matching transcript snippets.
//
//   $env:DATABASE_URL = "<DATABASE_PUBLIC_URL>"
//   node lib/db/scripts/search-transcripts.mjs "funding port" "term sheet"

import pg from "pg";

const terms = process.argv.slice(2);
if (terms.length === 0) {
  console.error("Usage: node search-transcripts.mjs <term> [<term> ...]");
  process.exit(1);
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });

try {
  // ILIKE OR-list — finds sessions where ANY term appears in ANY transcript.
  const where = terms.map((_, i) => `t.text ILIKE $${i + 1}`).join(" OR ");
  const params = terms.map((t) => `%${t}%`);

  const sql = `
    SELECT
      t.session_id,
      s.title,
      s.mode,
      s.status,
      s.user_id,
      u.username,
      s.created_at,
      t.start_ms,
      t.speaker_label,
      t.text
    FROM transcripts t
    JOIN sessions s ON s.id = t.session_id
    LEFT JOIN users u ON u.id = s.user_id
    WHERE ${where}
    ORDER BY s.created_at DESC, t.start_ms ASC
  `;

  const { rows } = await pool.query(sql, params);
  if (rows.length === 0) {
    console.log("No matches found.");
    process.exit(0);
  }

  // Group by session
  const bySession = new Map();
  for (const r of rows) {
    if (!bySession.has(r.session_id)) bySession.set(r.session_id, { meta: r, hits: [] });
    bySession.get(r.session_id).hits.push(r);
  }

  for (const { meta, hits } of bySession.values()) {
    console.log("─".repeat(70));
    console.log(`Session #${meta.session_id}  "${meta.title}"  mode=${meta.mode}  status=${meta.status}`);
    console.log(`  user=${meta.username ?? "?"}  created=${meta.created_at.toISOString().slice(0, 19).replace("T", " ")}`);
    console.log(`  ${hits.length} hit${hits.length === 1 ? "" : "s"}:`);
    for (const h of hits) {
      const sec = Math.floor(h.start_ms / 1000);
      const m = Math.floor(sec / 60);
      const s = sec % 60;
      console.log(`    [${m}:${s.toString().padStart(2, "0")}  ${h.speaker_label}]  ${h.text.replace(/\s+/g, " ").slice(0, 200)}`);
    }
  }
  console.log("─".repeat(70));
  console.log(`Total: ${rows.length} hits in ${bySession.size} session(s).`);
} catch (err) {
  console.error("Search failed:", err.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
