const BASE = process.argv[2] ?? "https://flowmind-production.up.railway.app";
let cookie = "", csrf = "";
async function api(path, opts = {}) {
  const headers = { "Content-Type": "application/json", ...(opts.headers ?? {}) };
  if (cookie) headers["Cookie"] = cookie;
  if (csrf && opts.method && opts.method !== "GET") headers["x-fm-csrf"] = csrf;
  const res = await fetch(BASE + path, { ...opts, headers });
  const sc = res.headers.getSetCookie?.() ?? [];
  if (sc.length) {
    const jar = new Map(cookie.split("; ").filter(Boolean).map((kv) => [kv.split("=")[0], kv]));
    for (const c of sc) { const kv = c.split(";")[0]; jar.set(kv.split("=")[0], kv); if (kv.startsWith("fm_csrf=")) csrf = decodeURIComponent(kv.split("=")[1]); }
    cookie = Array.from(jar.values()).join("; ");
  }
  return res;
}
await api("/api/auth/login", { method: "POST", body: JSON.stringify({ username: "marcel", password: "Admin1234!!" }) });
console.log("login ok");

// Ask about something the Wave 21 test stored (Müller GmbH / Kevin / deadline)
for (const q of [
  "Was war nochmal mit Müller GmbH und dem Angebot?",
  "Wer ist der Entscheider bei Müller und bis wann braucht er das Angebot?",
  "Welche Geburtstage habe ich gespeichert?",
  "Was weiß ich über ein Raumschiff auf dem Mars?", // expect honest "nichts gespeichert"
]) {
  const r = await api("/api/brain/ask", { method: "POST", body: JSON.stringify({ question: q }) });
  const j = await r.json().catch(() => ({}));
  console.log(`\nQ: ${q}`);
  console.log(`A: ${j.answer ?? "(error " + r.status + ")"}`);
  console.log(`   sources: ${(j.sources ?? []).map((s) => s.label).join(", ") || "(none)"}`);
}
