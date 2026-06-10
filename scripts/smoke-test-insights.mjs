// Targeted test: insight generation (Wave 17 path with brief + profile).
// Creates a session, posts a meaty transcript with a clear question, then
// calls the explicit insight-generate endpoint and polls the list.

const BASE = process.argv[2] ?? "https://flowmind-production.up.railway.app";
let cookie = "";
let csrf = "";

async function api(path, opts = {}) {
  const headers = { "Content-Type": "application/json", ...(opts.headers ?? {}) };
  if (cookie) headers["Cookie"] = cookie;
  if (csrf && opts.method && opts.method !== "GET") headers["x-fm-csrf"] = csrf;
  const res = await fetch(BASE + path, { ...opts, headers });
  const setCookie = res.headers.getSetCookie?.() ?? [];
  if (setCookie.length) {
    const jar = new Map(cookie.split("; ").filter(Boolean).map((kv) => [kv.split("=")[0], kv]));
    for (const c of setCookie) {
      const kv = c.split(";")[0];
      jar.set(kv.split("=")[0], kv);
      if (kv.startsWith("fm_csrf=")) csrf = decodeURIComponent(kv.split("=")[1]);
    }
    cookie = Array.from(jar.values()).join("; ");
  }
  return res;
}

// Login
const login = await api("/api/auth/login", {
  method: "POST",
  body: JSON.stringify({ username: "marcel", password: "Admin1234!!" }),
});
console.log("login:", login.status);

// Create insight session
const cs = await api("/api/sessions", {
  method: "POST",
  body: JSON.stringify({ title: "Insight smoke", mode: "insight" }),
});
const session = await cs.json();
console.log("session:", session.id);

// Post transcript with a clear, fact-seeking question
const lines = [
  "Guten Tag, ich bin Marcel von der Deutschen Leasing, schön dass Sie da sind.",
  "Wir besprechen heute, wie wir unser Leasing-Angebot für mittelständische IT-Unternehmen erweitern können.",
  "Unsere Kunden fragen vor allem nach flexiblen Laufzeiten und Software-Leasing.",
  "Was wären denn aus Ihrer Sicht die drei wichtigsten Schritte, um im Software-Leasing-Markt Fuß zu fassen?",
];
for (let i = 0; i < lines.length; i++) {
  await api(`/api/sessions/${session.id}/transcripts`, {
    method: "POST",
    body: JSON.stringify({ speakerLabel: i % 2 === 0 ? "Speaker A" : "Speaker B", text: lines[i], startMs: i * 8000 }),
  });
}
console.log("transcripts posted");

// Explicit generate call
const gen = await api(`/api/ai/insights/generate`, {
  method: "POST",
  body: JSON.stringify({ sessionId: session.id }),
});
const genBody = await gen.json().catch(() => ({}));
console.log("generate:", gen.status, JSON.stringify(genBody).slice(0, 400));

// List insights
const list = await api(`/api/ai/insights?sessionId=${session.id}`);
const insights = await list.json().catch(() => []);
console.log(`insights in DB: ${Array.isArray(insights) ? insights.length : "?"}`);
for (const i of (insights ?? []).slice(0, 3)) {
  console.log(`  [${i.category}] ${i.suggestion?.slice(0, 120)}`);
}

// Check the session brief was generated (Wave 17)
const sess = await api(`/api/sessions/${session.id}`);
const sessBody = await sess.json().catch(() => ({}));
console.log("brief present:", !!sessBody.brief, sessBody.brief ? JSON.stringify(sessBody.brief).slice(0, 200) : "");

// Cleanup
await api(`/api/sessions/${session.id}/end`, { method: "PATCH" });
await api(`/api/sessions/${session.id}`, { method: "DELETE" });
console.log("cleaned up");
