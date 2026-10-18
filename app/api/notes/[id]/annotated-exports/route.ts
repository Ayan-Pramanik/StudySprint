import {checkOrigin,errorResponse,requireWorkspaceId} from '@/lib/server/workspace-store';
import {boundedJSON,startAnnotatedExport} from '@/lib/server/annotations';
import {publicJob} from '@/lib/server/import-jobs';
export async function POST(req:Request,{params}:{params:Promise<{id:string}>}){try{checkOrigin(req);return Response.json({job:publicJob(await startAnnotatedExport(await requireWorkspaceId(req),(await params).id,await boundedJSON(req,4096)))},{status:202});}catch(e){return errorResponse(e);}}
