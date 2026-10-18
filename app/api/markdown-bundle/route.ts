import {exportMarkdownBundle} from '@/lib/server/markdown-bundles';
import {errorResponse} from '@/lib/server/workspace-store';
export async function GET(req:Request){try{return await exportMarkdownBundle(req);}catch(e){return errorResponse(e);}}
