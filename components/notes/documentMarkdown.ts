import {createElement} from 'react';
import {defaultUrlTransform} from 'react-markdown';
export function documentUrl(note:string){return(url:string)=>/^asset:[a-f0-9-]{36}$/i.test(url)?'/api/notes/'+encodeURIComponent(note)+'/assets/'+url.slice(6):defaultUrlTransform(url);}

export function DocumentImage({src,alt}:{src?:string|Blob;alt?:string}){if(typeof src==='string'&&(/^(https?:)?\/\//i.test(src)||/^\/api\/notes\/[^/]+\/assets\//.test(src)))return createElement('img',{src,alt:alt||'Document figure'});return createElement('span',{className:'missing-image'},'Missing local image: '+(alt||src||'figure')+'. Import its folder or ZIP with the image files.');}
