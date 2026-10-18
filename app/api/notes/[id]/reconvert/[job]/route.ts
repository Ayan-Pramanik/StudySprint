import {checkOrigin,errorResponse,requireWorkspaceId} from '@/lib/server/workspace-store';
import {applyReconversion,reviewReconversion} from '@/lib/server/documents';
import {boundedJSON} from '@/lib/server/annotations';
export async function GET(req:Request,{params}:{params:Promise<{id:string;job:string}>}){try{const workspace=await requireWorkspaceId(req),{id,job}=await params;return Response.json(await reviewReconversion(workspace,id,job),{headers:{'Cache-Control':'private, no-store'}});}catch(e){return errorResponse(e);}}
export async function POST(req:Request,{params}:{params:Promise<{id:string;job:string}>}){try{checkOrigin(req);const workspace=await requireWorkspaceId(req),{id,job}=await params,{expectedUpdated}=await boundedJSON(req,4096);return Response.json(await applyReconversion(workspace,id,job,expectedUpdated));}catch(e){return errorResponse(e);}}
