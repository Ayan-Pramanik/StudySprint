'use client';
import {useId,useRef,useState,type DragEvent} from 'react';
import {FileUp} from 'lucide-react';
import type {ImportJob,WorkspaceSnapshot} from '../../lib/study';

type Props={w:WorkspaceSnapshot;title:string;subject:string;uploads:boolean;write:(data:{title:string;subject:string;newSubject:string;body:string})=>Promise<void>;uploaded:(job:ImportJob)=>void};
export function CreateNoteDialog({w,title:initialTitle,subject:initialSubject,uploads,write,uploaded}:Props){
 const [title,setTitle]=useState(initialTitle),[subject,setSubject]=useState(initialSubject),[newSubject,setNewSubject]=useState('');
 const [file,setFile]=useState<File>(),[saving,setSaving]=useState(false),[error,setError]=useState(''),[fileError,setFileError]=useState(''),[dragging,setDragging]=useState(false);
 const input=useRef<HTMLInputElement>(null),chooser=useRef<HTMLButtonElement>(null),dragDepth=useRef(0),requestId=useRef(crypto.randomUUID()),suggestedTitle=useRef(initialTitle);
 const helpId=useId(),errorId=useId();
 function choose(files:File[],directory=false){
  if(saving||!uploads)return;
  setError('');setFileError('');setFile(undefined);
  if(directory){setFileError('Choose one file. Folders cannot be uploaded here.');return;}
  if(files.length!==1){setFileError('Choose one file at a time.');return;}
  const selected=files[0];
  if(!/\.(pdf|docx|pptx|md|markdown|txt)$/i.test(selected.name)){setFileError('Choose a PDF, Word document (.docx), PowerPoint (.pptx), Markdown, or text file.');return;}
  if(!selected.size||selected.size>10*1024*1024){setFileError('Choose a non-empty file up to 10 MiB.');return;}
  setFile(selected);requestId.current=crypto.randomUUID();
  if(!title||title===suggestedTitle.current){const suggestion=selected.name.replace(/\.[^.]+$/,'').slice(0,200);suggestedTitle.current=suggestion;setTitle(suggestion);}
 }
 function clearFile(){setFile(undefined);setFileError('');setError('');if(input.current)input.current.value='';chooser.current?.focus();}
 function dragOver(e:DragEvent){e.preventDefault();e.stopPropagation();e.dataTransfer.dropEffect=saving||!uploads?'none':'copy';}
 return <form onSubmit={async e=>{
  e.preventDefault();if(saving||fileError)return;setSaving(true);setError('');
  try{
   if(!file){await write({title,subject:subject==='new'?'':subject,newSubject:subject==='new'?newSubject:'',body:''});}
   else{
    const data=new FormData();data.set('file',file);data.set('title',title);data.set('subject',subject==='new'?'':subject);data.set('newSubject',subject==='new'?newSubject:'');data.set('requestId',requestId.current);
    const response=await fetch('/api/note-imports',{method:'POST',body:data});const result=await response.json() as {job:ImportJob;error?:string};
    if(!response.ok)throw Error(result.error||'The upload could not start.');uploaded(result.job);
   }
  }catch(e){setError((e as Error).message);}finally{setSaving(false);}
 }}>
  <h2>Make room for an idea.</h2>
  <label>Note title<input value={title} onChange={e=>setTitle(e.target.value)} disabled={saving} required autoFocus maxLength={200}/></label>
  <label>Subject<select value={subject} onChange={e=>setSubject(e.target.value)} disabled={saving}>{w.subjects.map(s=><option value={s.id} key={s.id}>{s.name}</option>)}<option value="">Uncategorised</option><option value="new">New subject…</option></select></label>
  {subject==='new'&&<label>New subject name<input value={newSubject} onChange={e=>setNewSubject(e.target.value)} disabled={saving} required maxLength={100}/></label>}
  <div className="note-upload" onDragEnter={e=>{dragOver(e);if(!saving&&uploads&&e.dataTransfer.types.includes('Files')){dragDepth.current++;setDragging(true);}}} onDragOver={dragOver} onDragLeave={e=>{e.preventDefault();e.stopPropagation();dragDepth.current=Math.max(0,dragDepth.current-1);if(!dragDepth.current)setDragging(false);}} onDrop={e=>{
   e.preventDefault();e.stopPropagation();dragDepth.current=0;setDragging(false);
   const directory=Array.from(e.dataTransfer.items).some(item=>item.webkitGetAsEntry?.()?.isDirectory);
   choose(Array.from(e.dataTransfer.files),directory);
  }}>
   <div className="note-upload-label">Upload a file <span>(optional)</span></div>
   <input ref={input} type="file" hidden aria-label="Study document" aria-describedby={helpId} disabled={saving||!uploads} accept=".pdf,.docx,.pptx,.md,.markdown,.txt" onChange={e=>{const files=Array.from(e.target.files||[]);if(files.length)choose(files);e.target.value='';}}/>
   <button ref={chooser} type="button" className={'note-file-dropzone'+(dragging?' dragging':'')} disabled={saving||!uploads} aria-label={file?'Choose a different study document':'Choose a study document'} aria-describedby={helpId+(fileError?' '+errorId:'')} onClick={()=>input.current?.click()}>
    <FileUp size={24} aria-hidden="true"/>
    <strong>{dragging?'Drop your file here':file?'Drop another file here':'Drag and drop a file here'}</strong>
    <span>or <span className="note-file-browse">choose a file</span></span>
   </button>
   <p className="small note-upload-help" id={helpId}>PDF, DOCX, PPTX, Markdown or TXT · one file · up to 10 MiB · PDF up to 100 pages</p>
   <div aria-live="polite">{file&&<div className="note-file-selection"><div><strong>{file.name}</strong><small>{file.size<1024?`${file.size} bytes`:`${(file.size/1024).toFixed(1)} KiB`}</small></div><button type="button" disabled={saving} onClick={clearFile}>Remove file</button></div>}</div>
   {fileError&&<div className="note-upload-error"><p id={errorId} role="alert" className="danger-text">{fileError}</p><button type="button" onClick={clearFile}>Clear file selection</button></div>}
   {!uploads&&<p role="status" className="warning">Document uploads are unavailable. You can still create a note.</p>}
   {file&&<p className="small note-upload-help">We’ll create editable Markdown and keep the original. English OCR is included for scans. You can keep studying while it converts.</p>}
  </div>
  {error&&<p role="alert" className="danger-text">{error}</p>}
  <button className="primary" disabled={saving||!!fileError||!!file&&!uploads}>{saving?(file?'Uploading…':'Creating…'):file?'Upload and create note':'Create note'}</button>
 </form>;
}
