/**
 * Browser regression scenarios. Accept a Codex browser Tab (cua_repl), or an
 * adapter exposing goto/reload/back/forward and a Playwright locator API.
 * Run against an isolated local database, never an existing user's workspace.
 */
const screens=[['/','Today'],['/focus','Focus'],['/notes','Notes'],['/graph','Graph'],['/cards','Cards'],['/review','Review'],['/progress','Progress'],['/settings','Settings']];
function check(value,message){if(!value)throw Error(message);}
export async function assertPath(tab,path){
 const actual=await tab.playwright.evaluate(()=>document.location.pathname);
 check(actual===path,`Expected ${path}; got ${actual}`);
}
async function ready(tab,section){await tab.playwright.locator('.topbar').getByText(section,{exact:true}).waitFor({state:'visible'});}
export async function checkScreenRoutes(tab,base){
 const passed=[];
 for(const [path,section] of screens){
  await tab.goto(base+path);await ready(tab,section);await assertPath(tab,path);
  await tab.reload();await ready(tab,section);await assertPath(tab,path);
  passed.push(`${path}: direct entry and refresh`);
 }
 for(const [,section] of screens.filter(([,s])=>s!=='Review')){
  await tab.playwright.getByRole('link',{name:section,exact:true}).click();await ready(tab,section);
  await assertPath(tab,screens.find(([,s])=>s===section)[0]);
 }
 await tab.playwright.getByRole('link',{name:'Notes',exact:true}).click();await ready(tab,'Notes');
 await tab.playwright.getByRole('link',{name:'Cards',exact:true}).click();await ready(tab,'Cards');
 await tab.back();await ready(tab,'Notes');await assertPath(tab,'/notes');
 await tab.forward();await ready(tab,'Cards');await assertPath(tab,'/cards');
 return [...passed,'navigation links and Back/Forward'];
}
export async function createBrowserNote(tab,{title,subject,body}){
 await tab.playwright.getByRole('button',{name:'Create note',exact:true}).first().click();
 const dialog=tab.playwright.getByRole('dialog',{name:'Workspace action'});
 await dialog.getByLabel('Note title',{exact:true}).fill(title);
 if(subject){await dialog.getByRole('combobox').selectOption('new');await dialog.getByLabel('New subject name').fill(subject);}
 await dialog.getByRole('button',{name:'Create note',exact:true}).click();
 await tab.playwright.getByRole('textbox',{name:'Note title',exact:true}).waitFor({state:'visible'});
 const path=await tab.playwright.evaluate(()=>document.location.pathname);
 check(/^\/notes\/[^/]+$/.test(path),'Created notes must navigate to their own URL');
 await tab.playwright.getByRole('textbox',{name:'Markdown note body'}).fill(body);
 await tab.playwright.getByRole('button',{name:'Saved',exact:true}).waitFor({state:'visible'});
 return {title,subject,body,path};
}
export async function checkNoteRoutes(tab,base,a,b){
 for(const note of [a,b]){
  await tab.goto(base+note.path);
  await tab.playwright.getByRole('textbox',{name:'Note title',exact:true}).waitFor({state:'visible'});
  check(await tab.playwright.getByRole('textbox',{name:'Note title',exact:true}).getAttribute('value')===note.title,'Direct note link opened the wrong title');
  await tab.reload();
  await tab.playwright.getByRole('textbox',{name:'Note title',exact:true}).waitFor({state:'visible'});
  await assertPath(tab,note.path);
 }
 await tab.playwright.getByRole('link',{name:a.title,exact:true}).first().click();await assertPath(tab,a.path);
 await tab.playwright.getByRole('textbox',{name:'Note title',exact:true}).waitFor({state:'visible'});
 await tab.back();await assertPath(tab,b.path);
 await tab.forward();await assertPath(tab,a.path);
 await tab.goto(base+'/notes/not-a-note');
 await tab.playwright.getByRole('heading',{name:'Note unavailable',exact:true}).waitFor({state:'visible'});
 await assertPath(tab,'/notes/not-a-note');
 await tab.goto(base+'/unknown-route');
 await tab.playwright.getByRole('heading',{name:'404',exact:true}).waitFor({state:'visible'});
 return ['note direct entry and refresh','note links and Back/Forward','missing note stays on its URL','unknown page returns 404'];
}

export async function checkPendingRecovery(tab,note){
 const marker='Pending edit survives navigation '+Date.now()+'.';
 await tab.playwright.getByRole('button',{name:'Edit',exact:true}).click();
 await tab.playwright.getByRole('textbox',{name:'Markdown note body'}).fill(note.body+'\n\n'+marker);
 await tab.playwright.getByRole('link',{name:'Cards',exact:true}).click();
 await ready(tab,'Cards');await tab.back();
 await tab.playwright.getByText(marker,{exact:true}).waitFor({state:'visible'});
 await tab.playwright.getByRole('button',{name:'Saved',exact:true}).waitFor({state:'visible'});
 await tab.reload();await tab.playwright.getByText(marker,{exact:true}).waitFor({state:'visible'});
 await assertPath(tab,note.path);
 return ['pending edit recovers after navigation before autosave','recovered text persists after refresh'];
}
export async function checkStableIdentity(tab,note){
 await tab.playwright.getByRole('textbox',{name:'Note title',exact:true}).fill(note.title+' renamed');
 await tab.playwright.getByRole('button',{name:'Saved',exact:true}).waitFor({state:'visible'});
 await assertPath(tab,note.path);
 await tab.playwright.getByRole('combobox',{name:'Note subject',exact:true}).selectOption('');
 await tab.playwright.getByRole('button',{name:'Saved',exact:true}).waitFor({state:'visible'});
 await assertPath(tab,note.path);await tab.reload();
 await tab.playwright.getByRole('textbox',{name:'Note title',exact:true}).waitFor({state:'visible'});
 check(await tab.playwright.getByRole('textbox',{name:'Note title',exact:true}).getAttribute('value')===note.title+' renamed','Rename did not survive refresh');
 await assertPath(tab,note.path);
 return ['rename preserves note URL','move to Uncategorised preserves note URL'];
}

export async function checkStaleTab(tab){
 await tab.playwright.getByRole('button',{name:'Edit',exact:true}).click();
 await tab.playwright.getByRole('textbox',{name:'Markdown note body'}).fill('Conflicting edit from a stale test tab.');
 await tab.playwright.getByRole('button',{name:'Save failed — retry',exact:true}).waitFor({state:'visible'});
 await tab.playwright.getByText(/This note changed in another tab/).first().waitFor({state:'visible'});
 return ['a stale tab cannot silently overwrite a newer note'];
}
