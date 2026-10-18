import {errorResponse,readNote,requireWorkspaceId} from '@/lib/server/workspace-store';
export async function GET(req:Request,{params}:{params:Promise<{id:string}>}){try{return Response.json({note:await readNote(await requireWorkspaceId(req),(await params).id)},{headers:{'Cache-Control':'no-store'}});}catch(e){return errorResponse(e);}}
