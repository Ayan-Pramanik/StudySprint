import './sites-env.mjs';
import {spawn} from 'node:child_process';
import {randomBytes,randomUUID} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {setupDatabase} from './db-setup.mjs';

if(!existsSync('dist/server/wrangler.json'))throw Error('Run npm run build before npm start.');
const path='.sites-runtime/converter.env';mkdirSync('.sites-runtime',{recursive:true});
function parse(text){const values={};for(const line of text.split('\n')){const m=/^([A-Z_][A-Z_0-9]*)=(.*)$/.exec(line.trim());if(m){try{values[m[1]]=JSON.parse(m[2]);}catch{values[m[1]]=m[2];}}}return values;}
const vars={...(existsSync('dist/server/.dev.vars')?parse(readFileSync('dist/server/.dev.vars','utf8')):{}),...(existsSync(path)?parse(readFileSync(path,'utf8')):{})};
vars.CONVERTER_URL=process.env.CONVERTER_URL||vars.CONVERTER_URL||'http://127.0.0.1:8001';vars.CONVERTER_SECRET=process.env.CONVERTER_SECRET||vars.CONVERTER_SECRET||randomBytes(32).toString('hex');vars.OCR_LANGUAGES=process.env.OCR_LANGUAGES||vars.OCR_LANGUAGES||'eng';
for(const key of ['AI_API_KEY','AI_MODEL','PUBLIC_ORIGIN','SPEECH_SERVICE_URL','SPEECH_SERVICE_SECRET'])if(process.env[key])vars[key]=process.env[key];
const text=Object.entries(vars).map(([key,value])=>`${key}=${JSON.stringify(value)}`).join('\n')+'\n';writeFileSync(path,text,{mode:0o600});writeFileSync('dist/server/.dev.vars',text,{mode:0o600});
setupDatabase();
const children=[];let stopping=false;function stop(signal='SIGTERM'){if(stopping)return;stopping=true;for(const child of children)child.kill(signal);}
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>stop(signal));
const local=new URL(vars.CONVERTER_URL).hostname==='127.0.0.1'&&new URL(vars.CONVERTER_URL).port==='8001';
async function health(){try{const response=await fetch(`${vars.CONVERTER_URL}/health`,{signal:AbortSignal.timeout(1000)});return response.ok?await response.json():null;}catch{return null;}}
const initialHealth=local?await health():null;
if(local&&initialHealth&&initialHealth.ready!==true)throw Error('The local converter is missing required OCR or Office tools. Check its /health response.');
if(local&&!initialHealth){
 if(!existsSync('converter/.venv/bin/python'))throw Error('Run npm run converter:setup before starting the app.');
 const converter=spawn('bash',['scripts/converter-run.sh'],{stdio:'inherit',env:{...process.env,...vars}});children.push(converter);
 let ready=false;for(let attempt=0;attempt<60;attempt++){if(converter.exitCode!==null)break;const status=await health();if(status?.ready===true){ready=true;break;}await new Promise(resolve=>setTimeout(resolve,500));}
 if(!ready){stop();throw Error('The converter did not become ready. Check Tesseract and LibreOffice prerequisites.');}
}
const auth=await fetch(`${vars.CONVERTER_URL}/artifacts/${randomUUID()}/preview`,{headers:{Authorization:`Bearer ${vars.CONVERTER_SECRET}`},signal:AbortSignal.timeout(3000)}).catch(()=>null);
if(local&&(!auth||auth.status===401||auth.status===403)){stop();throw Error('The local converter does not match this workspace configuration. Restart it with the saved converter environment.');}
const app=spawn(process.execPath,['--import','./scripts/sites-env.mjs','./node_modules/wrangler/bin/wrangler.js','dev','--config','dist/server/wrangler.json','--local','--persist-to','.wrangler/state','--ip','127.0.0.1','--port','8787','--inspector-port','0'],{stdio:'inherit',env:process.env});children.push(app);
app.on('exit',code=>{stop();process.exitCode=code??1;});app.on('error',error=>{console.error(error.message);stop();process.exitCode=1;});
