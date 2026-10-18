import assert from 'node:assert/strict';
export async function createSession(base){
 const email=`test-${crypto.randomUUID()}@example.com`;
 const response=await fetch(base+'/api/auth/signup',{method:'POST',headers:{'Content-Type':'application/json',Origin:new URL(base).origin},body:JSON.stringify({email,name:'Integration Test',password:'correct horse battery'})});
 assert.equal(response.status,200,await response.clone().text());
 const cookie=response.headers.get('set-cookie').split(';')[0];
 const r=await fetch(base+'/api/workspace?zone=Australia%2FSydney',{headers:{cookie}});assert.equal(r.status,200);
 return {cookie,email,...await r.json()};
}
