// One-shot script to reset all seed accounts back to their original
// passwords with passwordMustChange=false so they can be used immediately
// for testing. Run with DATABASE_URL pointing at the prod DB.
//
//   $env:DATABASE_URL = "<DATABASE_PUBLIC_URL from Railway>"
//   node scripts/reset-seed-passwords.mjs

import { createRequire } from "node:module";
import pg from "pg";

// bcrypt lives under artifacts/api-server's deps in this monorepo; reach
// into the pnpm hoist directly so we don't need to add it as a dep of
// lib/db just for this one-shot script.
const require = createRequire(import.meta.url);
const bcrypt = require("../../../node_modules/.pnpm/bcrypt@6.0.0/node_modules/bcrypt");

const SEED = [
  { username: "marcel", password: "Admin1234!!" },
  { username: "user1",  password: "Password1234!" },
  { username: "user2",  password: "Password1234!" },
  { username: "user3",  password: "Password1234!" },
  { username: "user4",  password: "Password1234!" },
];

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

const pool = new pg.Pool({
  connectionString: url,
  ssl: { rejectUnauthorized: false },
});

let touched = 0;
let missing = 0;
try {
  for (const u of SEED) {
    const hash = await bcrypt.hash(u.password, 12);
    const res = await pool.query(
      `UPDATE users
         SET password_hash = $1,
             password_must_change = false,
             updated_at = now()
       WHERE username = $2
       RETURNING id, username, plan, is_admin`,
      [hash, u.username]
    );
    if (res.rowCount === 0) {
      console.log(`  ✗ ${u.username} — not in DB`);
      missing++;
    } else {
      const row = res.rows[0];
      console.log(`  ✓ ${u.username.padEnd(10)} plan=${row.plan.padEnd(8)} admin=${row.is_admin}  →  ${u.password}`);
      touched++;
    }
  }
} catch (err) {
  console.error("Reset failed:", err.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}

console.log(`\nDone. Updated ${touched} accounts. Missing: ${missing}.`);
