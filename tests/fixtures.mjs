import {empty,uid,makeCard,scheduler,bindLinks} from '../lib/study.ts';
export function workspace(){
 const w=empty(),subject={id:uid(),name:'Test subject'};w.subjects.push(subject);
 for(const title of ['Concept A','Concept B']){const n={id:uid(),subject:subject.id,title,body:`${title} is a useful definition for testing source-based learning. Related: [[${title==='Concept A'?'Concept B':'Concept A'}]].`,aliases:[],updated:new Date().toISOString(),version:1};w.notes.push(n);for(let i=0;i<3;i++){const c=makeCard(n,`Question ${title} ${i}`,`Answer ${i}`,n.body,i===2?'draft':'active');if(i===0){c.schedule=scheduler.next(c.schedule,new Date(Date.now()-86400000),3).card;c.schedule.due=new Date(Date.now()-60000);}w.cards.push(c);}}
 w.notes.forEach(n=>bindLinks(w,n));return w;
}
