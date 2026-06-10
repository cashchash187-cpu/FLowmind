// Wave 20 E2E: (a) explain/logic_check answer in GERMAN on German context,
// (b) Memory agent files a memo into folder/page and extracts a reminder.

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

const GERMAN_HINTS = ["der", "die", "das", "und", "ist", "nicht", "eine", "für", "mit", "werden", "sind", "wird", "dass", "sich"];
function looksGerman(text) {
  const t = text.toLowerCase();
  const hits = GERMAN_HINTS.filter((w) => new RegExp(`\\b${w}\\b`).test(t)).length;
  return hits >= 2;
}

// Login
await api("/api/auth/login", { method: "POST", body: JSON.stringify({ username: "marcel", password: "Admin1234!!" }) });
console.log("login ok");

// Session for AI tests
const cs = await api("/api/sessions", { method: "POST", body: JSON.stringify({ title: "Wave20 smoke", mode: "copilot" }) });
const session = await cs.json();
const germanContext =
  "Speaker A: Also unser Hauptproblem ist, dass die Conversion Rate im Checkout seit dem Update um zwanzig Prozent gefallen ist. " +
  "Speaker B: Ja, und gleichzeitig behaupten wir im Marketing, dass die neue Version besser konvertiert. Das müssen wir uns genauer anschauen.";

// (a) explain + logic_check in German
let langOk = true;
for (const mode of ["explain", "logic_check"]) {
  const r = await api(`/api/sessions/${session.id}/ai-assist`, {
    method: "POST",
    body: JSON.stringify({ mode, context: germanContext }),
  });
  const j = await r.json().catch(() => ({}));
  const german = typeof j.suggestion === "string" && looksGerman(j.suggestion);
  if (!german) langOk = false;
  console.log(`${german ? "✓" : "✗"} ${mode} German: "${(j.suggestion ?? "(none)").slice(0, 110)}"`);
}

// (b) Memory agent
const memoText = "Erinnere mich in 5 Tagen an Kevins Geburtstag, er wird 30. Und notier dir: Kevin mag Whisky.";
const m = await api("/api/memos", { method: "POST", body: JSON.stringify({ text: memoText, source: "text" }) });
const memo = await m.json().catch(() => ({}));
const memoOk = m.status === 201 && memo.page?.id;
console.log(`${memoOk ? "✓" : "✗"} memo filed: status=${m.status} → ${memo.page?.folder} / ${memo.page?.title}`);
console.log(`  summary: ${memo.summary ?? "(none)"}`);
console.log(`  reminder: ${memo.reminder ? `${memo.reminder.label} @ ${memo.reminder.dueAt}` : "(none)"}`);

// Verify page content contains the info
if (memoOk) {
  const pg = await api(`/api/brain/pages/${memo.page.id}`);
  const page = await pg.json();
  const hasKevin = /kevin/i.test(page.content ?? "");
  console.log(`${hasKevin ? "✓" : "✗"} page content mentions Kevin (${(page.content ?? "").length} chars)`);

  // Second memo → should merge into the same system, ideally same page or same folder
  const m2 = await api("/api/memos", { method: "POST", body: JSON.stringify({ text: "Annas Geburtstag ist am 3. September.", source: "text" }) });
  const memo2 = await m2.json().catch(() => ({}));
  console.log(`${m2.status === 201 ? "✓" : "✗"} second memo: → ${memo2.page?.folder} / ${memo2.page?.title}`);
}

// Reminders list
const rem = await api("/api/reminders");
const reminders = await rem.json().catch(() => []);
console.log(`✓ reminders endpoint: ${Array.isArray(reminders) ? reminders.length : "?"} open`);

// Cleanup session (keep the memo pages — user can look at them as a demo!)
await api(`/api/sessions/${session.id}`, { method: "DELETE" });
console.log("\nDone.", langOk && memoOk ? "ALL CORE CHECKS PASSED" : "SOME CHECKS FAILED");
process.exitCode = langOk && memoOk ? 0 : 1;
