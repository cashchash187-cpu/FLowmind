// End-to-end smoke test against the deployed FlowMind instance.
// Tests every user-facing feature that can be exercised over HTTP:
// login, session CRUD, transcripts, AI assist (LLM), insights engine,
// research (Tavily), notes generation, usage, folders.
//
//   node scripts/smoke-test.mjs https://flowmind-production.up.railway.app

const BASE = process.argv[2] ?? "https://flowmind-production.up.railway.app";
const results = [];
let cookie = "";
let csrf = "";

function record(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? "  — " + detail : ""}`);
}

async function api(path, opts = {}) {
  const headers = { "Content-Type": "application/json", ...(opts.headers ?? {}) };
  if (cookie) headers["Cookie"] = cookie;
  if (csrf && opts.method && opts.method !== "GET") headers["x-fm-csrf"] = csrf;
  const res = await fetch(BASE + path, { ...opts, headers });
  // Capture cookies from response
  const setCookie = res.headers.getSetCookie?.() ?? [];
  if (setCookie.length) {
    const parts = [];
    for (const c of setCookie) {
      const kv = c.split(";")[0];
      parts.push(kv);
      if (kv.startsWith("fm_csrf=")) csrf = decodeURIComponent(kv.split("=")[1]);
    }
    // Merge with existing cookie names
    const jar = new Map(cookie.split("; ").filter(Boolean).map((kv) => [kv.split("=")[0], kv]));
    for (const p of parts) jar.set(p.split("=")[0], p);
    cookie = Array.from(jar.values()).join("; ");
  }
  return res;
}

let sessionId = null;
let token = "";

try {
  // 1. Health
  {
    const r = await fetch(BASE + "/health");
    record("health", r.ok, `status ${r.status}`);
  }

  // 2. Config
  {
    const r = await fetch(BASE + "/api/config");
    const j = await r.json();
    record("config", r.ok, `research=${j.researchAvailable} stripe=${j.stripeAvailable}`);
  }

  // 3. Login
  {
    const r = await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username: "marcel", password: "Admin1234!!" }),
    });
    const j = await r.json().catch(() => ({}));
    token = j.token ?? "";
    record("login (marcel)", r.ok && !!j.user, `status ${r.status} user=${j.user?.username} admin=${j.user?.isAdmin}`);
    if (token) {
      // also pass as bearer for routes that need it
    }
  }

  const authHeaders = token ? { Authorization: `Bearer ${token}` } : {};

  // 4. Current user
  {
    const r = await api("/api/auth/me", { headers: authHeaders });
    record("auth/me", r.ok, `status ${r.status}`);
  }

  // 5. Usage
  {
    const r = await api("/api/usage/current", { headers: authHeaders });
    const j = await r.json().catch(() => ({}));
    record("usage/current", r.ok, `aiUsed=${j.aiRequestsUsed ?? "?"}/${j.aiRequestsLimit ?? "?"}`);
  }

  // 6. Sessions stats + recent (route-order sensitive!)
  {
    const r1 = await api("/api/sessions/stats", { headers: authHeaders });
    record("sessions/stats", r1.ok, `status ${r1.status}`);
    const r2 = await api("/api/sessions/recent", { headers: authHeaders });
    record("sessions/recent", r2.ok, `status ${r2.status}`);
  }

  // 7. Create session
  {
    const r = await api("/api/sessions", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ title: `Smoke test ${new Date().toISOString()}`, mode: "insight" }),
    });
    const j = await r.json().catch(() => ({}));
    sessionId = j.id ?? null;
    record("create session", r.ok && !!sessionId, `id=${sessionId}`);
  }

  // 8. Add transcripts (simulates browser STT path)
  if (sessionId) {
    const lines = [
      "Hallo zusammen, ich bin Marcel von der Deutschen Leasing und heute sprechen wir über unsere Digitalstrategie.",
      "Unser Ziel ist es, den Mittelstand mit flexiblen Leasing-Angeboten für IT-Infrastruktur zu erreichen.",
      "Welche Wachstumszahlen hatte der deutsche Leasingmarkt im Jahr 2025?",
    ];
    let allOk = true;
    for (let i = 0; i < lines.length; i++) {
      const r = await api(`/api/sessions/${sessionId}/transcripts`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ speakerLabel: "Speaker A", text: lines[i], startMs: i * 5000 }),
      });
      if (!r.ok) allOk = false;
    }
    record("add transcripts", allOk, `${lines.length} lines`);
  }

  // 9. AI assist (LLM round-trip — the most likely silent failure)
  if (sessionId) {
    const r = await api(`/api/sessions/${sessionId}/ai-assist`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        mode: "answer",
        context: "Speaker A: Welche Wachstumszahlen hatte der deutsche Leasingmarkt 2025?",
      }),
    });
    const j = await r.json().catch(() => ({}));
    const ok = r.ok && typeof j.suggestion === "string" && j.suggestion.length > 10;
    record("AI assist (LLM)", ok, ok ? `"${j.suggestion.slice(0, 80)}…"` : `status ${r.status} ${JSON.stringify(j).slice(0, 200)}`);
  }

  // 10. Research (Tavily + LLM query derivation)
  if (sessionId) {
    const r = await api(`/api/research`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ sessionId, trigger: "manual" }),
    });
    const j = await r.json().catch(() => ({}));
    const ok = r.ok && typeof j.answer === "string";
    record("research (Tavily)", ok, ok ? `query="${(j.query ?? "").slice(0, 60)}"` : `status ${r.status} ${JSON.stringify(j).slice(0, 200)}`);
  }

  // 11. Insights list (lazy ticker revive)
  if (sessionId) {
    const r = await api(`/api/ai/insights?sessionId=${sessionId}`, { headers: authHeaders });
    record("insights list", r.ok, `status ${r.status}`);
  }

  // 12. Notes generation (LLM)
  if (sessionId) {
    const r = await api(`/api/sessions/${sessionId}/ai-summary`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({}),
    });
    const j = await r.json().catch(() => ({}));
    record("notes generation (LLM)", r.ok, r.ok ? `summary="${(j.summary ?? "").slice(0, 60)}…"` : `status ${r.status} ${JSON.stringify(j).slice(0, 150)}`);
  }

  // 13. Folders
  {
    const r = await api(`/api/folders`, { headers: authHeaders });
    record("folders list", r.ok, `status ${r.status}`);
  }

  // 14. End + delete the smoke session (cleanup)
  if (sessionId) {
    const r1 = await api(`/api/sessions/${sessionId}/end`, { method: "PATCH", headers: authHeaders });
    record("end session", r1.ok, `status ${r1.status}`);
    const r2 = await api(`/api/sessions/${sessionId}`, { method: "DELETE", headers: authHeaders });
    record("delete session (cleanup)", r2.ok || r2.status === 204, `status ${r2.status}`);
  }
} catch (err) {
  console.error("\nSmoke test crashed:", err.message);
  process.exitCode = 1;
}

const failed = results.filter((r) => !r.ok);
console.log("\n" + "═".repeat(60));
console.log(`${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
  console.log("FAILED:");
  for (const f of failed) console.log(`  ✗ ${f.name} — ${f.detail}`);
  process.exitCode = 1;
}
