import {existsSync} from 'node:fs';
import {spawn} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const [major,minor]=process.versions.node.split('.').map(Number);
const local=path.join(root,'node_modules','node','bin',process.platform==='win32'?'node.exe':'node');
const runtime=(major>22||major===22&&minor>=13)?process.execPath:local;
if(!existsSync(runtime)){console.error('StudySprint needs Node 22.13+. Run npm install to install the project-local runtime, or activate Node 22.');process.exit(1);}
const args=process.argv.slice(2);
if(!args.length){console.error('A script or Node argument is required.');process.exit(1);}
const child=spawn(runtime,args,{cwd:root,stdio:'inherit',env:{...process.env,PATH:path.dirname(runtime)+path.delimiter+process.env.PATH}});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill(signal));
child.on('error',e=>{console.error(e.message);process.exitCode=1;});
child.on('exit',(code,signal)=>{process.exitCode=code??(signal?1:0);});
