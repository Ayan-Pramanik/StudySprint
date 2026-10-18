import {z} from 'zod';

export const MAX_ASSET_BYTES=8*1024*1024;
export const MAX_ASSETS=200;
export const MAX_ASSET_TOTAL=40*1024*1024;
export const MAX_ANNOTATION_BYTES=32*1024;
export const MAX_ANNOTATIONS=1000;
export const MAX_ANNOTATION_TOTAL=2*1024*1024;
export type PageGeometry={mediaBox:number[];cropBox:number[];rotation:number;userUnit:number};
export type DocumentBase={id:string;sha256:string;size:number;kind:'pdf'|'searchable-pdf'|'office-pdf'|'text-pdf';pages:PageGeometry[]};
export type DocumentAsset={id:string;mediaType:'image/png'|'image/jpeg';size:number;sha256:string;width:number;height:number;page?:number;bbox?:number[];alt?:string};
export type ConversionInfo={engine:string;warnings:string[]};
export type AnnotationData={type:'highlight'|'underline'|'comment'|'ink';page:number;color:string;quads?:number[][];points?:number[][];anchor?:number[];text?:string;width?:number};
export type Annotation={id:string;version:number;data:AnnotationData;updated:string};
export type AnnotationSnapshot={base:DocumentBase|null;version:number;count:number;annotations:Annotation[]};
const coordinate=z.number().finite().min(-100000).max(100000);
const point=z.array(coordinate).length(2);
const annotationSchema=z.object({
 type:z.enum(['highlight','underline','comment','ink']),page:z.number().int().min(1).max(100),
 color:z.string().regex(/^#[a-fA-F0-9]{6}$/),quads:z.array(z.array(coordinate).length(8)).min(1).max(200).optional(),
 points:z.array(point).min(2).max(1500).optional(),anchor:point.optional(),text:z.string().trim().min(1).max(4000).optional(),width:z.number().finite().min(.25).max(20).optional(),
}).strict();
export function validateAnnotation(value:unknown,pages:PageGeometry[]):AnnotationData{
 const data=annotationSchema.parse(value);
 if(new TextEncoder().encode(JSON.stringify(data)).length>MAX_ANNOTATION_BYTES)throw Error('This annotation is too large. Use a shorter comment or drawing.');
 const page=pages[data.page-1];if(!page)throw Error('Annotation page is unavailable.');
 if((data.type==='highlight'||data.type==='underline')&&!data.quads)throw Error('Select text or a page region first.');
 if(data.type==='ink'&&!data.points)throw Error('Draw a stroke first.');
 if(data.type==='comment'&&(!data.anchor||!data.text))throw Error('Place a comment and enter its text.');
 const [left,bottom,right,top]=page.cropBox;
 const coordinates=[...(data.points||[]),...(data.anchor?[data.anchor]:[]),...(data.quads||[]).flatMap(q=>[[q[0],q[1]],[q[2],q[3]],[q[4],q[5]],[q[6],q[7]]])];
 if(coordinates.some(([x,y])=>x<left-1||x>right+1||y<bottom-1||y>top+1))throw Error('Place annotations inside the document page.');
 return data;
}
export const ASSET_ID=/^[a-f0-9-]{36}$/i;
export function rewriteAssetReferences(body:string,map:Map<string,string>){return body.replace(/asset:([a-f0-9-]{36})/gi,(match,id)=>map.has(id)?'asset:'+map.get(id):match);}
