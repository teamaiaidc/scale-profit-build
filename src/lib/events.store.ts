// Client-side event store backed by the browser's localStorage.
// Edits made in /admin are saved here and read back by the public pages — so they
// show up immediately, but only in the same browser (no server/database involved).
import { DEFAULT_EVENTS, normalizeEvent, type EventRow } from "./events";

const STORAGE_KEY = "scale-profit-events";

export function loadStoredEvents(fallback: EventRow[] = DEFAULT_EVENTS): EventRow[] {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<EventRow>[];
    if (!Array.isArray(parsed) || parsed.length === 0) return fallback;
    return parsed.map(normalizeEvent);
  } catch {
    return fallback;
  }
}

export function saveStoredEvents(events: EventRow[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(events));
  } catch {
    /* ignore quota / privacy-mode errors */
  }
}
