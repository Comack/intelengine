const USER_ACTIVITY_EVENT = 'wm:user-activity';

let lastBroadcastAt = 0;

export function broadcastUserActivity(minIntervalMs = 220): void {
  if (typeof window === 'undefined') return;
  const now = Date.now();
  if (now - lastBroadcastAt < minIntervalMs) return;
  lastBroadcastAt = now;
  window.dispatchEvent(new CustomEvent(USER_ACTIVITY_EVENT, { detail: { at: now } }));
}

export function onUserActivity(handler: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const wrapped = () => handler();
  window.addEventListener(USER_ACTIVITY_EVENT, wrapped);
  return () => window.removeEventListener(USER_ACTIVITY_EVENT, wrapped);
}

