import { sameOrigin, logIn } from '../../../../lib/auth';
export async function POST(req: Request) { return sameOrigin(req) ? logIn(req) : new Response(JSON.stringify({ error: 'Invalid origin' }), { status: 403, headers: { 'Content-Type': 'application/json' } }); }
