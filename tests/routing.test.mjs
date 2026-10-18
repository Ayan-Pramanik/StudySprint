import test from 'node:test';
import assert from 'node:assert/strict';
import {sectionPaths,workspaceRoute,notePath} from '../lib/routes.ts';

test('every workspace screen has a direct route, including Today at the existing root',()=>{
 assert.equal(sectionPaths.Today,'/');
 for(const [section,path] of Object.entries(sectionPaths)){
  assert.deepEqual(workspaceRoute(path),{section});
  if(path!=='/')assert.deepEqual(workspaceRoute(path+'/'),{section});
 }
});
test('note routes round-trip opaque IDs without depending on titles or subjects',()=>{
 for(const id of ['ec868e4e-7c25-4fca-86b2-816ea196fb91','legacy-id','résumé / ?#%']){
  assert.deepEqual(workspaceRoute(notePath(id)),{section:'Notes',noteId:id});
 }
 assert.equal(notePath('same-id'),'/notes/same-id');
});
test('unrecognised paths and malformed encoded IDs cannot become Today or another screen',()=>{
 for(const path of ['/unknown','/folders/id','/notes/id/extra','/notes/%invalid','/Notes','//','/notes//'])assert.equal(workspaceRoute(path),undefined,path);
});
