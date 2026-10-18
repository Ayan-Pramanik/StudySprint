import { validOrigin } from './request-security.ts';

type Environment = Cloudflare.Env;
type Fetch = typeof fetch;

const json = (value: unknown, status = 200) => Response.json(value, {
  status,
  headers: { 'Cache-Control': 'no-store' },
});

export function speechConfiguration(environment: Environment) {
  const address = environment.SPEECH_SERVICE_URL?.trim();
  const secret = environment.SPEECH_SERVICE_SECRET;
  if (!address || !secret) return undefined;
  const url = new URL(address);
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('The speech service must use a local HTTP origin.');
  }
  return { origin: url.origin, secret };
}

/** Runs before the framework so WebSocket upgrades keep their native response. */
export async function handleDictation(request: Request, environment: Environment, upstreamFetch: Fetch = fetch, resolveWorkspaceId: (request: Request) => Promise<string | undefined> = async () => undefined): Promise<Response | undefined> {
  const url = new URL(request.url);
  if (url.pathname !== '/api/dictation' && url.pathname !== '/api/dictation/status') return undefined;
  try {
    if (request.method !== 'GET') return json({ error: 'Method not allowed.' }, 405);
    const streaming = url.pathname === '/api/dictation';
    if (!validOrigin(request, environment, streaming)) return json({ error: 'Invalid origin.' }, 403);
    const workspaceId = await resolveWorkspaceId(request);
    const workspace = workspaceId && environment.DB && await environment.DB.prepare('SELECT id FROM workspaces WHERE id=?').bind(workspaceId).first();
    if (!workspace) return json({ error: 'Reload to start your workspace.' }, 401);
    const configuration = speechConfiguration(environment);
    if (!configuration) {
      return streaming
        ? json({ error: 'Dictation is not configured.' }, 503)
        : json({ configured: false, available: false, busy: false });
    }
    if (!streaming) {
      try {
        const response = await upstreamFetch(`${configuration.origin}/health`, {
          headers: { Authorization: `Bearer ${configuration.secret}` },
          signal: AbortSignal.timeout(2000),
          redirect: 'manual',
        });
        const health: unknown = response.ok ? await response.json() : null;
        const state = health as { available?: unknown; busy?: unknown } | null;
        return json({ configured: true, available: state?.available === true, busy: state?.busy === true });
      } catch {
        return json({ configured: true, available: false, busy: false });
      }
    }
    if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') return json({ error: 'A WebSocket connection is required.' }, 426);
    const noteId = url.searchParams.get('noteId');
    if (!noteId || !await environment.DB!.prepare('SELECT id FROM notes WHERE workspace=? AND id=?').bind(workspaceId, noteId).first()) return json({ error: 'Note unavailable.' }, 404);
    const response = await upstreamFetch(`${configuration.origin}/asr?mode=full`, {
      headers: { Upgrade: 'websocket', Authorization: `Bearer ${configuration.secret}` },
      redirect: 'manual',
      // Vinext's request memoization must not clone/cache an upgraded socket.
      cache: 'no-store',
      signal: new AbortController().signal,
    });
    if (response.status !== 101 || !response.webSocket) return json({ error: 'Dictation is unavailable. Try again shortly.' }, 503);
    return new Response(null, { status: 101, webSocket: response.webSocket });
  } catch {
    // Configuration, database and upstream errors must never expose secrets.
    return json({ error: 'Dictation is unavailable. Try again shortly.' }, 503);
  }
}
