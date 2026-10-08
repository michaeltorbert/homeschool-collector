import {createServer} from 'node:http';
import {readFileSync,mkdirSync} from 'node:fs';
import {createServer as createVite} from 'vite';
import {Store} from './store.ts';
import {createHandler} from './app.ts';
import {SourceChecker,importArchives} from './sourceCheck.ts';
const port=Number(process.env.PORT??4173);const origin=`http://127.0.0.1:${port}`;
mkdirSync(new URL('../data/',import.meta.url),{recursive:true});const store=new Store(new URL('../data/preview.sqlite',import.meta.url).pathname);
const capturedAt='2026-10-04T02:35:33.636296Z';
// Dated public archives go through the archived completion wrapper; a conflicting fixed-batch receipt is reported safely
// and the server continues with retained data.
if(store.snapshot().items.length===0)console.log('Archive import:',JSON.stringify(importArchives(store,part=>readFileSync(new URL(`../fixtures/${part}.ics`,import.meta.url),'utf8'),capturedAt)));
store.reparseLatest('1.1');
// Local age extractor/comparison-algorithm corrections on unchanged stored source and profile become separate local attention, never source changes.
store.recheckAgeAssessments();
const checker=new SourceChecker(store);
const vite=await createVite({server:{middlewareMode:true,host:'127.0.0.1',allowedHosts:['127.0.0.1','localhost'],hmr:{port:port+1,host:'127.0.0.1'}},appType:'spa'});
const app=createServer(createHandler({store,port:()=>port,scan:()=>checker.scan(),scanState:()=>checker.state(),fallback:(req,res)=>vite.middlewares(req,res,()=>{res.writeHead(404);res.end();})}));
app.listen(port,'127.0.0.1',()=>console.log(`Town events local preview: ${origin}`));
// Exactly one ordinary two-part source check on first startup; saved results are reused on later starts.
if(store.snapshot().sources.every(s=>s.kind==='archived'&&s.health==='ok'))checker.scan().then(r=>console.log('Initial ordinary source check:',JSON.stringify(r))).catch(()=>console.log('Initial scan unavailable.'));
