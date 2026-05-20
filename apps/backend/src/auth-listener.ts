/**
 * Listener identification — anonymous users get a UUID stored in localStorage.
 * Frontend sends it as `X-Listener-Id` header or `?listenerId=` query.
 */

export interface RequestLike {
  headers: Record<string, string | string[] | undefined>;
  query: Record<string, unknown>;
}

export function extractListenerId(req: RequestLike): string | null {
  const header = req.headers['x-listener-id'];
  if (typeof header === 'string' && header.length > 0) return header;
  const q = req.query.listenerId;
  if (typeof q === 'string' && q.length > 0) return q;
  return null;
}
