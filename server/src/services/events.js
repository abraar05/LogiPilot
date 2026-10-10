/**
 * services/events.js — in-process realtime hub (Server-Sent Events).
 * Broadcasts order changes to every connected client of an organisation.
 */
const channels = new Map();   // orgId → Set<res>

export function subscribe(orgId, res) {
  if (!channels.has(orgId)) channels.set(orgId, new Set());
  channels.get(orgId).add(res);
  res.write(`event: ready\ndata: ${JSON.stringify({ orgId, at: Date.now() })}\n\n`);
  return () => channels.get(orgId)?.delete(res);
}

export function publish(orgId, payload) {
  const set = channels.get(orgId);
  if (!set?.size) return 0;
  const frame = `event: ${payload.type}\ndata: ${JSON.stringify(payload)}\n\n`;
  let sent = 0;
  for (const res of set) {
    try { res.write(frame); sent += 1; } catch { set.delete(res); }
  }
  return sent;
}

export const listenerCount = (orgId) => channels.get(orgId)?.size || 0;