/**
 * Persistent transcript buffer backed by sessionStorage.
 *
 * Protects against data loss when the user navigates away during an active
 * session before the DB save completes. On remount the pending entries are
 * re-queued and saved again.
 */

export interface BufferedEntry {
  localId: string;
  sessionId: number;
  speakerLabel: string;
  text: string;
  startMs: number;
  savedAt?: number; // set when DB save confirmed
}

const STORAGE_KEY = (sessionId: number) => `flowmind_buffer_${sessionId}`;

export function readBuffer(sessionId: number): BufferedEntry[] {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY(sessionId));
    return raw ? (JSON.parse(raw) as BufferedEntry[]) : [];
  } catch {
    return [];
  }
}

export function writeToBuffer(sessionId: number, entry: Omit<BufferedEntry, "savedAt">): void {
  try {
    const existing = readBuffer(sessionId);
    const updated = [...existing.filter((e) => e.localId !== entry.localId), entry];
    sessionStorage.setItem(STORAGE_KEY(sessionId), JSON.stringify(updated));
  } catch {
    // sessionStorage full or unavailable — silently skip
  }
}

export function markSaved(sessionId: number, localId: string): void {
  try {
    const existing = readBuffer(sessionId);
    const updated = existing.filter((e) => e.localId !== localId);
    if (updated.length === 0) {
      sessionStorage.removeItem(STORAGE_KEY(sessionId));
    } else {
      sessionStorage.setItem(STORAGE_KEY(sessionId), JSON.stringify(updated));
    }
  } catch {}
}

export function clearBuffer(sessionId: number): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY(sessionId));
  } catch {}
}

/** Pending entries = not yet confirmed saved */
export function pendingEntries(sessionId: number): BufferedEntry[] {
  return readBuffer(sessionId).filter((e) => !e.savedAt);
}
