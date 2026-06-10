// Test the /api/ws/transcribe WebSocket bridge end-to-end:
// login → open WS with token → send init → expect "ready" (which means
// the server successfully opened a Deepgram streaming session).

// Node 24 ships a native WebSocket global — no dependency needed.
const BASE = process.argv[2] ?? "https://flowmind-production.up.railway.app";
const WS_BASE = BASE.replace(/^http/, "ws");

// Login via fetch to get a bearer token
const loginRes = await fetch(BASE + "/api/auth/login", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ username: "marcel", password: "Admin1234!!" }),
});
const login = await loginRes.json();
if (!login.token) {
  console.error("login failed:", loginRes.status, JSON.stringify(login).slice(0, 200));
  process.exit(1);
}
console.log("login ok");

// Need a session id — create one
const csrfCookie = loginRes.headers.getSetCookie?.().find((c) => c.startsWith("fm_csrf="));
const sessionCookies = (loginRes.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
const csrf = csrfCookie ? decodeURIComponent(csrfCookie.split(";")[0].split("=")[1]) : "";

const csRes = await fetch(BASE + "/api/sessions", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Cookie": sessionCookies,
    "x-fm-csrf": csrf,
  },
  body: JSON.stringify({ title: "WS smoke", mode: "copilot" }),
});
const session = await csRes.json();
console.log("session:", session.id);

const url = `${WS_BASE}/api/ws/transcribe?token=${encodeURIComponent(login.token)}`;
const ws = new WebSocket(url);

const timeout = setTimeout(() => {
  console.error("✗ TIMEOUT — no ready after 20 s (Deepgram bridge broken?)");
  cleanup(1);
}, 20_000);

function cleanup(code) {
  clearTimeout(timeout);
  try { ws.close(); } catch {}
  // Delete the smoke session
  fetch(`${BASE}/api/sessions/${session.id}`, {
    method: "DELETE",
    headers: { "Cookie": sessionCookies, "x-fm-csrf": csrf },
  }).finally(() => process.exit(code));
}

ws.addEventListener("open", () => {
  console.log("WS connected — sending init");
  ws.send(JSON.stringify({ type: "init", sessionId: session.id, language: "de", diarize: false }));
});

ws.addEventListener("message", (ev) => {
  const msg = JSON.parse(typeof ev.data === "string" ? ev.data : ev.data.toString());
  console.log("WS message:", JSON.stringify(msg).slice(0, 200));
  if (msg.type === "ready") {
    console.log("✓ Deepgram bridge READY — live STT chain is healthy");
    cleanup(0);
  }
  if (msg.type === "error") {
    console.error("✗ STT error:", msg.message);
    cleanup(1);
  }
});

ws.addEventListener("close", (ev) => {
  console.log("WS closed:", ev.code, ev.reason);
});

ws.addEventListener("error", () => {
  console.error("✗ WS error");
  cleanup(1);
});
