import { sameOrigin, logOut } from '../../../../lib/auth';
export async function POST(req: Request) { return sameOrigin(req) ? logOut(req) : new Response(JSON.stringify({ error: 'Invalid origin' }), { status: 403, headers: { 'Content-Type': 'application/json' } }); }
