import {errorResponse,requireWorkspaceId} from '@/lib/server/workspace-store';
import {downloadAnnotatedExport} from '@/lib/server/annotations';
export async function GET(req:Request,{params}:{params:Promise<{id:string;job:string}>}){try{const workspace=await requireWorkspaceId(req),{id,job}=await params;return await downloadAnnotatedExport(workspace,id,job);}catch(e){return errorResponse(e);}}
