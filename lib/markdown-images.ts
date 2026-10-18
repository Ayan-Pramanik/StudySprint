import {unified} from 'unified';
import remarkParse from 'remark-parse';
// Parse actual image nodes, including reference-style images. Code examples
// and escaped brackets must never be interpreted as uploaded image paths.
export function imageReferences(markdown:string){
 const tree=unified().use(remarkParse).parse(markdown),definitions=new Map<string,string>(),images:{match:string;url:string;alt:string}[]=[];
 function walk(node:any,visit:(node:any)=>void){visit(node);for(const child of node.children||[])walk(child,visit);}
 walk(tree,node=>{if(node.type==='definition')definitions.set(node.identifier,node.url);});
 walk(tree,node=>{const url=node.type==='image'?node.url:node.type==='imageReference'?definitions.get(node.identifier):undefined;if(url&&node.position)images.push({match:markdown.slice(node.position.start.offset,node.position.end.offset),url,alt:node.alt||''});});return images;
}
export function markdownImage(alt:string,url:string){return '!['+alt.replace(/[\\\[\]]/g,'\\$&')+']('+url+')';}
