import {errorResponse,requireWorkspaceId} from '@/lib/server/workspace-store';
import {annotationSnapshot} from '@/lib/server/annotations';
export async function GET(req:Request,{params}:{params:Promise<{id:string}>}){try{return Response.json(await annotationSnapshot(await requireWorkspaceId(req),(await params).id),{headers:{'Cache-Control':'private, no-store'}});}catch(e){return errorResponse(e);}}
