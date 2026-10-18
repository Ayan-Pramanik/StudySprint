import {checkOrigin,errorResponse,requireWorkspaceId} from '@/lib/server/workspace-store';
import {startDocumentJob} from '@/lib/server/documents';
import {publicJob} from '@/lib/server/import-jobs';
export async function POST(req:Request,{params}:{params:Promise<{id:string}>}){try{checkOrigin(req);return Response.json({job:publicJob(await startDocumentJob(await requireWorkspaceId(req),(await params).id,'reconvert'))},{status:202});}catch(e){return errorResponse(e);}}
