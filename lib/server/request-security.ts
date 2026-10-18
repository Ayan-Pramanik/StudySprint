type PublicEnvironment = { PUBLIC_ORIGIN?: string };

/** A configured public origin is explicit; forwarded headers are never trusted. */
export function applicationOrigin(request: Request, environment: PublicEnvironment): string {
  const configured = environment.PUBLIC_ORIGIN?.trim();
  if (!configured) return new URL(request.url).origin;
  const url = new URL(configured);
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('PUBLIC_ORIGIN must be an HTTPS origin without a path.');
  }
  return url.origin;
}

export function validOrigin(request: Request, environment: PublicEnvironment, required = false): boolean {
  if (request.headers.get('sec-fetch-site') === 'cross-site') return false;
  const origin = request.headers.get('origin');
  if (!origin) return !required;
  return origin === applicationOrigin(request, environment);
}

export function guestId(request: Request): string | undefined {
  return request.headers.get('cookie')?.match(/(?:^|;\s*)ss_guest=([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})(?:;|$)/)?.[1];
}

export function guestIdentity(request: Request, environment: PublicEnvironment) {
  const existing = guestId(request);
  if (existing) return { id: existing, cookie: undefined };
  const id = crypto.randomUUID();
  const secure = new URL(applicationOrigin(request, environment)).protocol === 'https:';
  return { id, cookie: `ss_guest=${id}; HttpOnly; SameSite=Lax; Path=/; Max-Age=31536000${secure ? '; Secure' : ''}` };
}
