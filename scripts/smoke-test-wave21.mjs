// Wave 21 E2E: meeting → memory bridge + live "Merken" button.

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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await api("/api/auth/login", { method: "POST", body: JSON.stringify({ username: "marcel", password: "Admin1234!!" }) });
console.log("login ok");

// Baseline counts
const pagesBefore = await (await api("/api/brain/pages")).json();
const remBefore = await (await api("/api/reminders")).json();
console.log(`baseline: ${pagesBefore.length} pages, ${remBefore.length} reminders`);

// Create + populate a session with action-item-rich content
const session = await (await api("/api/sessions", { method: "POST", body: JSON.stringify({ title: "Deutsche Leasing × Müller GmbH", mode: "copilot" }) })).json();
console.log("session:", session.id);

const lines = [
  "Speaker A: Schön dass es klappt. Also Kevin Schuster von der Müller GmbH ist bei euch der Entscheider für das Flottenleasing, richtig?",
  "Speaker B: Genau, Kevin entscheidet das. Er braucht aber bis zum 20. Juni unser finales Angebot, sonst geht das Budget ins nächste Quartal.",
  "Speaker A: Verstanden, finales Leasing-Angebot bis 20. Juni an Kevin. Wir reden über 45 Fahrzeuge, Laufzeit 36 Monate.",
  "Speaker B: Korrekt, 45 E-Transporter. Und wichtig: Müller GmbH hat schon ein Konkurrenzangebot von der Deutschen Bank über 1,2 Millionen liegen.",
  "Speaker A: Gut zu wissen. Ich schicke Kevin außerdem die ESG-Zertifizierung mit, das war ihm wichtig.",
];
for (let i = 0; i < lines.length; i++) {
  await api(`/api/sessions/${session.id}/transcripts`, { method: "POST", body: JSON.stringify({ speakerLabel: lines[i].startsWith("Speaker A") ? "Speaker A" : "Speaker B", text: lines[i].replace(/^Speaker [AB]: /, ""), startMs: i * 7000 }) });
}
console.log(`${lines.length} transcript lines posted`);

// ── Test B: live "Merken" ──
const merk = await api("/api/memos", { method: "POST", body: JSON.stringify({ text: `[Live aus Meeting "${session.title}"] Speaker B: Müller GmbH hat ein Konkurrenzangebot von der Deutschen Bank über 1,2 Millionen.`, source: "meeting" }) });
const merkBody = await merk.json().catch(() => ({}));
console.log(`${merk.status === 201 ? "✓" : "✗"} live Merken: → ${merkBody.page?.folder} / ${merkBody.page?.title}`);

// ── Test A: end session → distiller fires (fire-and-forget, so poll) ──
await api(`/api/sessions/${session.id}/end`, { method: "PATCH" });
console.log("session ended — waiting for distiller…");

let pagesAfter = pagesBefore, remAfter = remBefore;
for (let attempt = 0; attempt < 12; attempt++) {
  await sleep(5000);
  pagesAfter = await (await api("/api/brain/pages")).json();
  remAfter = await (await api("/api/reminders")).json();
  if (pagesAfter.length > pagesBefore.length || remAfter.length > remBefore.length) break;
  process.stdout.write(".");
}
console.log("");

const newPages = pagesAfter.length - pagesBefore.length;
const newRem = remAfter.length - remBefore.length;
console.log(`${newPages > 0 ? "✓" : "✗"} distiller created ${newPages} new page(s)`);
console.log(`${newRem > 0 ? "✓" : "✗"} distiller created ${newRem} new reminder(s)`);

// Show what landed
console.log("\nPages now:");
for (const p of pagesAfter.slice(0, 12)) console.log(`  [${p.folder}] ${p.title}`);
console.log("Open reminders now:");
for (const r of remAfter.slice(0, 8)) console.log(`  ⏰ ${r.label} — ${new Date(r.dueAt).toLocaleDateString("de-DE")}`);

// Verify a page mentions Kevin (the key person)
const kevinPage = pagesAfter.find((p) => /kevin|müller/i.test(p.title));
if (kevinPage) {
  const full = await (await api(`/api/brain/pages/${kevinPage.id}`)).json();
  console.log(`\n✓ Page "${kevinPage.title}" content:\n${(full.content ?? "").slice(0, 400)}`);
}

const pass = merk.status === 201 && (newPages > 0 || newRem > 0);
console.log("\n" + (pass ? "ALL CORE CHECKS PASSED" : "SOME CHECKS FAILED"));
process.exitCode = pass ? 0 : 1;
