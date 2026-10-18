import { env } from 'cloudflare:workers';
import { z } from 'zod';
import { applicationOrigin } from './server/request-security';
import { uid } from './study';

// Every workspace belongs to an email/password account. Passwords are stored as salted PBKDF2-SHA256 hashes and
// sessions as SHA-256 hashes of a random token kept in an HttpOnly cookie.
const SESSION_DAYS = 30, ITERATIONS = 100000, MAX_FAILURES = 5, LOCK_MS = 15 * 60000;

// Behind a TLS-terminating proxy (e.g. nginx) the Worker sees http://; X-Forwarded-Proto gives the scheme the browser used.
// Browsers cannot set this header on cross-site requests, so honouring it keeps the origin check meaningful.
export function publicOrigin(req: Request) { if(env.PUBLIC_ORIGIN)return applicationOrigin(req,env); const url = new URL(req.url); const proto = req.headers.get('x-forwarded-proto')?.split(',')[0].trim(); return `${proto === 'https' || proto === 'http' ? proto + ':' : url.protocol}//${url.host}`; }
export const sameOrigin = (req: Request) => !req.headers.get('origin') || req.headers.get('origin') === publicOrigin(req);
const readCookie = (req: Request, name: string) => req.headers.get('cookie')?.match(new RegExp(`(?:^|; )${name}=([^;]*)`))?.[1];
const setCookie = (req: Request, name: string, value: string, maxAge: number) => `${name}=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${publicOrigin(req).startsWith('https:') ? '; Secure' : ''}`;
const b64 = (bytes: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64 = (value: string) => Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), ch => ch.charCodeAt(0));
const sha256 = async (value: string) => b64(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
async function pbkdf2(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number) { const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']); return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256)); }
async function hashPassword(password: string) { const salt = crypto.getRandomValues(new Uint8Array(16)); return `pbkdf2$${ITERATIONS}$${b64(salt)}$${b64(await pbkdf2(password, salt, ITERATIONS))}`; }
async function checkPassword(password: string, stored: string) { const [, iterations, salt, hash] = stored.split('$'); const actual = await pbkdf2(password, unb64(salt), Number(iterations)), expected = unb64(hash); let diff = actual.length ^ expected.length; actual.forEach((b, i) => { diff |= b ^ (expected[i] ?? 0); }); return diff === 0; }
// Unknown emails still pay for one hash so response time does not reveal which addresses have accounts.
const DUMMY = `pbkdf2$${ITERATIONS}$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`;
const reply = (data: unknown, status = 200, cookies: string[] = []) => new Response(JSON.stringify(data), { status, headers: [['Content-Type', 'application/json'], ['Cache-Control', 'no-store'], ...cookies.map(c => ['Set-Cookie', c] as [string, string])] });

export type User = { email: string; name: string };
export type Identity = { id: string; user: User };

// Resolves the signed-in user's workspace; undefined means the visitor must log in.
export async function identity(req: Request): Promise<Identity | undefined> {
    const token = readCookie(req, 'ss_session');
    if (!token) return;
    const row = await env.DB!.prepare('SELECT u.workspace,u.email,u.name FROM sessions s JOIN users u ON u.id=s.user WHERE s.id=? AND s.expires>?').bind(await sha256(token), Date.now()).first<{ workspace: string } & User>();
    return row ? { id: row.workspace, user: { email: row.email, name: row.name } } : undefined;
}

async function startSession(req: Request, user: string, extra: string[] = []) {
    const db = env.DB!, token = b64(crypto.getRandomValues(new Uint8Array(32)));
    await db.batch([db.prepare('DELETE FROM sessions WHERE expires<?').bind(Date.now()), db.prepare('INSERT INTO sessions (id,user,expires) VALUES (?,?,?)').bind(await sha256(token), user, Date.now() + SESSION_DAYS * 86400000)]);
    return reply({ ok: true }, 200, [setCookie(req, 'ss_session', token, SESSION_DAYS * 86400), ...extra]);
}

const email = z.string().trim().toLowerCase().max(254).email('Enter a valid email address.');
const credentials = z.object({ email, password: z.string().min(1, 'Enter your password.').max(200) });
const signup = z.object({ name: z.string().trim().min(1, 'Enter your name.').max(100), email, password: z.string().min(8, 'Use at least 8 characters for your password.').max(200, 'Use at most 200 characters for your password.') });
const parse = async <T>(req: Request, schema: z.ZodType<T>) => { const result = schema.safeParse(await req.json().catch(() => ({}))); return result.success ? { data: result.data } : { error: result.error.issues[0].message }; };

export async function signUp(req: Request) {
    const { data, error } = await parse(req, signup);
    if (!data) return reply({ error }, 400);
    const db = env.DB!;
    if (await db.prepare('SELECT 1 FROM users WHERE email=?').bind(data.email).first()) return reply({ error: 'An account with this email already exists. Log in instead.' }, 409);
    // A new account keeps the work already in this browser's pre-account guest workspace, unless an account owns it.
    const guest = readCookie(req, 'ss_guest')?.match(/^[a-f0-9-]{36}$/)?.[0];
    const adopt = guest && await db.prepare('SELECT 1 FROM workspaces w WHERE w.id=? AND NOT EXISTS (SELECT 1 FROM users u WHERE u.workspace=w.id)').bind(guest).first();
    const id = uid();
    try { await db.prepare('INSERT INTO users (id,email,name,password,workspace,created) VALUES (?,?,?,?,?,?)').bind(id, data.email, data.name, await hashPassword(data.password), adopt ? guest : uid(), Date.now()).run(); }
    catch { return reply({ error: 'An account with this email already exists. Log in instead.' }, 409); }
    return startSession(req, id, guest ? [setCookie(req, 'ss_guest', '', 0)] : []);
}

export async function logIn(req: Request) {
    const { data, error } = await parse(req, credentials);
    if (!data) return reply({ error }, 400);
    const db = env.DB!;
    const user = await db.prepare('SELECT id,password,failures,locked FROM users WHERE email=?').bind(data.email).first<{ id: string; password: string; failures: number; locked: number }>();
    if (user && user.locked > Date.now()) return reply({ error: `Too many failed attempts. Try again in ${Math.ceil((user.locked - Date.now()) / 60000)} minutes.` }, 429);
    const valid = await checkPassword(data.password, user?.password || DUMMY);
    if (!user || !valid) {
        if (user) { const failures = user.failures + 1; await db.prepare('UPDATE users SET failures=?,locked=? WHERE id=?').bind(failures >= MAX_FAILURES ? 0 : failures, failures >= MAX_FAILURES ? Date.now() + LOCK_MS : 0, user.id).run(); }
        return reply({ error: 'Email or password is incorrect.' }, 401);
    }
    if (user.failures) await db.prepare('UPDATE users SET failures=0 WHERE id=?').bind(user.id).run();
    return startSession(req, user.id);
}

export async function logOut(req: Request) {
    const token = readCookie(req, 'ss_session');
    if (token) await env.DB!.prepare('DELETE FROM sessions WHERE id=?').bind(await sha256(token)).run();
    return reply({ ok: true }, 200, [setCookie(req, 'ss_session', '', 0)]);
}
