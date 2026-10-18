export async function workspaceReady(base, { publicCheck = false, browserOrigin, fetcher = fetch } = {}) {
  const headers = { 'ngrok-skip-browser-warning': 'studysprint-readiness' };
  const response = await fetcher(base + '/api/workspace', { headers, signal: AbortSignal.timeout(5000) });
  if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) return false;
  const data = await response.json();
  if (!data.workspace || !Number.isInteger(data.version)) return false;
  const cookie = response.headers.get('set-cookie');
  if (!cookie) return false;
  const guest = { ...headers, cookie: cookie.split(';')[0] };
  const status = await fetcher(base + '/api/dictation/status', { headers: guest, signal: AbortSignal.timeout(5000) });
  if (!status.ok || (await status.json()).available !== true) return false;
  if (publicCheck && !cookie.includes('; Secure')) throw Error('The public URL did not receive a Secure guest cookie. Check PUBLIC_ORIGIN and tunnel forwarding.');
  // A public run is probed over loopback before its tunnel starts. The browser
  // origin must still match the explicitly configured public HTTPS origin.
  const origin = browserOrigin ?? new URL(base).origin;
  const probe = await fetcher(base + '/api/workspace', {
    method: 'POST', headers: { ...guest, Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: '__judges_origin_probe__' }), signal: AbortSignal.timeout(5000),
  });
  if (probe.status !== 400 || (await probe.json()).error !== 'Unknown action') throw Error('Same-origin writes did not pass the origin check.');
  // Check the streaming route's stricter Origin policy without opening a recording.
  const streaming = await fetcher(base + '/api/dictation', { headers: { ...guest, Origin: origin }, signal: AbortSignal.timeout(5000) });
  if (streaming.status !== 426 || (await streaming.json()).error !== 'A WebSocket connection is required.') throw Error('The dictation streaming route did not accept the browser origin.');
  return true;
}
