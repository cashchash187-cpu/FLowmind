// Local production replica: pulls env from the Railway CLI, then starts
// the BUILT api-server bundle (which also serves the built frontend, same
// as the Docker deploy). Gives us a faithful local copy of prod at :8080
// for browser-level testing.

import { execSync, spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const railway = `${process.env.USERPROFILE}\\.npm-global\\railway.cmd`;

function kv(service) {
  const out = execSync(`"${railway}" variables --service ${service} --kv`, { encoding: "utf8" });
  const map = {};
  for (const line of out.split("\n")) {
    const i = line.indexOf("=");
    if (i > 0) map[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return map;
}

console.log("Pulling env from Railway…");
const appVars = kv("flowmind");
const pgVars = kv("Postgres");

const env = {
  ...process.env,
  NODE_ENV: "production",
  PORT: "8080",
  HOST: "127.0.0.1",
  // Local replica must use the PUBLIC pg URL (internal one only resolves
  // inside Railway's network).
  DATABASE_URL: pgVars.DATABASE_PUBLIC_URL,
  AUTH_JWT_SECRET: appVars.AUTH_JWT_SECRET ?? appVars.JWT_SECRET,
  LLM_API_KEY: appVars.LLM_API_KEY,
  LLM_BASE_URL: appVars.LLM_BASE_URL,
  LLM_MODEL: appVars.LLM_MODEL,
  DEEPGRAM_API_KEY: appVars.DEEPGRAM_API_KEY,
  TAVILY_API_KEY: appVars.TAVILY_API_KEY,
  PUBLIC_DIR: path.join(root, "artifacts", "flowmind", "dist", "public"),
};

if (!env.DATABASE_URL) {
  console.error("Could not resolve DATABASE_PUBLIC_URL from Railway Postgres service");
  process.exit(1);
}

console.log("Starting local prod replica on http://127.0.0.1:8080 …");
const child = spawn(process.execPath, ["--enable-source-maps", path.join(root, "artifacts", "api-server", "dist", "index.mjs")], {
  env,
  stdio: "inherit",
});
child.on("exit", (code) => process.exit(code ?? 0));
