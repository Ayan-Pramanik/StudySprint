import {checkOrigin,errorResponse,getBucket,getDatabase,HttpError,requireWorkspaceId} from '@/lib/server/workspace-store';
import {MAX_ASSET_BYTES,MAX_ASSETS,type DocumentAsset} from '@/lib/documents';
import {sniffImage} from '@/lib/pasted-images';

/** Stores one image pasted into a note's editor. The note then references it as `asset:<id>`. */
export async function POST(req:Request,{params}:{params:Promise<{id:string}>}){
 try{
  checkOrigin(req);
  const workspace=await requireWorkspaceId(req),{id:note}=await params,db=getDatabase();
  if(!await db.prepare('SELECT id FROM notes WHERE workspace=? AND id=?').bind(workspace,note).first())throw new HttpError(404,'Save the note before adding images.');
  const declared=Number(req.headers.get('content-length')||0);
  if(declared>MAX_ASSET_BYTES)throw new HttpError(413,'Images can be at most 8 MiB.');
  const bytes=new Uint8Array(await req.arrayBuffer());
  if(!bytes.length)throw new HttpError(400,'The pasted image was empty.');
  if(bytes.length>MAX_ASSET_BYTES)throw new HttpError(413,'Images can be at most 8 MiB.');
  const image=sniffImage(bytes);
  if(!image||!image.width||!image.height||image.width>20000||image.height>20000)throw new HttpError(415,'Only PNG and JPEG images can be added.');
  const count=await db.prepare('SELECT COUNT(*) AS n FROM document_assets WHERE workspace=? AND note=?').bind(workspace,note).first<{n:number}>();
  if((count?.n??0)>=MAX_ASSETS)throw new HttpError(409,`A note can hold at most ${MAX_ASSETS} images.`);
  const id=crypto.randomUUID(),key=`documents/${workspace}/${note}/assets/${id}.${image.mediaType==='image/jpeg'?'jpg':'png'}`;
  const sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
  const alt=(new URL(req.url).searchParams.get('alt')||'').slice(0,200);
  const asset:DocumentAsset={id,mediaType:image.mediaType,size:bytes.length,sha256,width:image.width,height:image.height,...(alt?{alt}:{})};
  await getBucket().put(key,bytes,{httpMetadata:{contentType:image.mediaType}});
  // document_files lets note deletion clean up the stored object; the 'paste' job needs no publication step.
  await db.batch([
   db.prepare("INSERT INTO document_files(object_key,workspace,note,job,kind,published,expires) VALUES(?,?,?,?,'asset',1,0)").bind(key,workspace,note,'paste-'+id),
   db.prepare('INSERT INTO document_assets(id,workspace,note,job,object_key,data,published) VALUES(?,?,?,?,?,?,1)').bind(id,workspace,note,'paste-'+id,key,JSON.stringify(asset)),
  ]);
  return Response.json({asset,url:'asset:'+id},{status:201});
 }catch(e){return errorResponse(e);}
}
