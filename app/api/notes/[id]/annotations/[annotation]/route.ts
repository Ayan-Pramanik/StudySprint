import {checkOrigin,errorResponse,requireWorkspaceId} from '@/lib/server/workspace-store';
import {boundedJSON,mutateAnnotation} from '@/lib/server/annotations';
async function change(req:Request,params:Promise<{id:string;annotation:string}>,remove:boolean){try{checkOrigin(req);const workspace=await requireWorkspaceId(req),{id,annotation}=await params;return Response.json(await mutateAnnotation(workspace,id,annotation,await boundedJSON(req),remove),{headers:{'Cache-Control':'no-store'}});}catch(e){return errorResponse(e);}}
export async function PUT(req:Request,{params}:{params:Promise<{id:string;annotation:string}>}){return change(req,params,false);}
export async function DELETE(req:Request,{params}:{params:Promise<{id:string;annotation:string}>}){return change(req,params,true);}
