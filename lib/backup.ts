import {z} from 'zod';
import {uid,preview,normalizeTags,type Workspace} from './study';
import {quizSchema,attemptSchema} from './quiz';
const text=z.string().max(1048576).refine(v=>new TextEncoder().encode(v).length<=1048576,'Note exceeds 1 MiB of text'), id=z.string().min(1).max(100), stamp=z.string().datetime();
const subject=z.object({id,name:z.string().trim().min(1).max(100)});
const note=z.object({id,subject:z.union([id,z.literal('')]),title:z.string().trim().min(1).max(200),body:text,aliases:z.array(text).max(1000),bindings:z.record(id).optional(),updated:stamp,version:z.number().int().positive(),versions:z.array(z.object({version:z.number().int().positive(),body:text,at:stamp})).max(1000).optional(),tags:z.array(z.string().max(200)).max(200).optional()});
const schedule=z.object({due:stamp,stability:z.number().nonnegative(),difficulty:z.number().nonnegative(),elapsed_days:z.number().nonnegative(),scheduled_days:z.number().nonnegative(),reps:z.number().int().nonnegative(),lapses:z.number().int().nonnegative(),state:z.number().int().min(0).max(3),last_review:stamp.optional(),learning_steps:z.number().int().nonnegative().optional()});
const card=z.object({id,subject:z.string().max(100),note:id.optional(),front:z.string().min(1).max(4000),answer:z.string().min(1).max(4000),type:z.enum(['basic','cloze']),excerpt:text,sourceVersion:z.number().int().nonnegative(),checked:z.boolean(),life:z.enum(['draft','active','suspended','archived']),schedule});
const event=z.object({id,card:id,rating:z.number().int().min(1).max(4),at:stamp,due:stamp,introduced:z.boolean()});
const schema=z.object({format:z.literal('studysprint'),version:z.literal(1),workspace:z.object({subjects:z.array(subject).max(1000),notes:z.array(note).max(5000),cards:z.array(card).max(20000),events:z.array(event).max(100000),quizzes:z.array(quizSchema).max(5000).optional(),quizAttempts:z.array(attemptSchema).max(100000).optional()})});
export function importBackup(w:Workspace,input:unknown){
 const data=schema.parse(input).workspace;
 const map=new Map<string,string>();
 for(const list of [data.subjects,data.notes,data.cards,data.events,data.quizzes||[]]){const seen=new Set<string>();for(const item of list){if(seen.has(item.id))throw Error('Backup has duplicate identifiers');seen.add(item.id);}}
 const subjectIds=new Set(data.subjects.map(s=>s.id));
 for(const n of data.notes)if(n.subject&&!subjectIds.has(n.subject))throw Error('Backup note references a missing subject');
 for(const c of data.cards){if(c.type==='cloze'&&(c.front.match(/\[\.\.\.\]/g)||[]).length!==1)throw Error('Backup contains an invalid cloze card');preview(c as any);}
 const mapped=(kind:string,value:string)=>{const key=kind+':'+value;if(!map.has(key))map.set(key,uid());return map.get(key)!;};
 w.subjects.push(...data.subjects.map(s=>({...s,id:mapped('subject',s.id),name:w.subjects.some(x=>x.name===s.name)?s.name+' (imported)':s.name})));
 w.notes.push(...data.notes.map(n=>({...n,...(n.tags?{tags:normalizeTags(n.tags)}:{}),id:mapped('note',n.id),subject:n.subject?mapped('subject',n.subject):'',bindings:Object.fromEntries(Object.entries(n.bindings||{}).map(([k,v])=>[k,mapped('note',v)]))})));
 w.cards.push(...data.cards.map(c=>({...c,id:mapped('card',c.id),subject:c.subject?mapped('subject',c.subject):'',note:c.note?mapped('note',c.note):undefined})));
 w.events.push(...data.events.map(e=>({...e,id:uid(),card:mapped('card',e.card)})));
 // Quizzes keep their question ids (attempts refer to them); attempts for quizzes missing from the backup are dropped.
 const quizIds=new Set((data.quizzes||[]).map(q=>q.id));
 w.quizzes=[...(w.quizzes||[]),...(data.quizzes||[]).map(q=>({...q,id:mapped('quiz',q.id),subject:q.subject&&subjectIds.has(q.subject)?mapped('subject',q.subject):''}))];
 w.quizAttempts=[...(w.quizAttempts||[]),...(data.quizAttempts||[]).filter(a=>quizIds.has(a.quiz)).map(a=>({...a,id:uid(),quiz:mapped('quiz',a.quiz)}))];
 return {notes:data.notes.length,cards:data.cards.length};
}
