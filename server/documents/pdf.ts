import {Worker} from 'node:worker_threads';
import {LIMITS} from './policy.ts';
export interface PdfItem {s:string;x:number;y:number;w:number;h:number;rot:boolean}
export interface PdfPage {page:number;width:number;height:number;items:PdfItem[]}
export type PdfFailure='too-large'|'timeout'|'resource-limit'|'crash'|'encrypted'|'malformed';
export type PdfResult={ok:true;numPages:number;pages:PdfPage[];truncated:null|'pages'|'chars'|'items';chars:number;items:number}|{ok:false;category:PdfFailure};
export const PDF_WORKER_URL=new URL('./pdfWorker.mjs',import.meta.url);
export interface ExtractOptions {workerUrl?:URL;timeoutMs?:number;heapMb?:number;limits?:{pages:number;chars:number;items:number}}
const num=(v:any)=>typeof v==='number'&&Number.isFinite(v);
function accept(m:any,limits:{pages:number;chars:number;items:number}):PdfResult{
 if(m?.ok===false)return {ok:false,category:m.category==='encrypted'?'encrypted':'malformed'};
 if(m?.ok!==true||!Number.isSafeInteger(m.numPages)||!Array.isArray(m.pages)||m.pages.length>limits.pages)return {ok:false,category:'crash'};
 const pages:PdfPage[]=[];let chars=0,items=0;
 for(const p of m.pages){
  if(!Number.isSafeInteger(p?.page)||!num(p.width)||!num(p.height)||!Array.isArray(p.items))return {ok:false,category:'crash'};
  const kept:PdfItem[]=[];
  for(const it of p.items){
   if(typeof it?.s!=='string'||![it.x,it.y,it.w,it.h].every(num))return {ok:false,category:'crash'};
   chars+=it.s.length;items++;kept.push({s:it.s,x:it.x,y:it.y,w:it.w,h:it.h,rot:it.rot===true});
  }
  pages.push({page:p.page,width:p.width,height:p.height,items:kept});
 }
 if(chars>limits.chars||items>limits.items)return {ok:false,category:'crash'};
 return {ok:true,numPages:m.numPages,pages,truncated:['pages','chars','items'].includes(m.truncated)?m.truncated:null,chars,items};
}
// Binary cap first; then a disposable worker with a 30 s wall clock and an explicit 192 MB old-generation JS heap limit.
// The heap limit is not a total RSS ceiling. The bytes are copied before transfer so the retained buffer is never detached.
export function extractPdf(bytes:Uint8Array,options:ExtractOptions={}):Promise<PdfResult>{
 if(bytes.byteLength>LIMITS.pdfBytes)return Promise.resolve({ok:false,category:'too-large'});
 const limits=options.limits??{pages:LIMITS.pages,chars:LIMITS.chars,items:LIMITS.items};
 const data=new Uint8Array(bytes);
 return new Promise(resolve=>{
  let settled=false,worker:Worker;
  try{
   worker=new Worker(options.workerUrl??PDF_WORKER_URL,{workerData:{data,limits},transferList:[data.buffer],execArgv:[],stdout:true,stderr:true,
    resourceLimits:{maxOldGenerationSizeMb:options.heapMb??LIMITS.workerHeapMb,maxYoungGenerationSizeMb:16}});
  }catch{resolve({ok:false,category:'crash'});return;}
  // Worker console output (pdf.js warnings) is drained and discarded, never logged.
  worker.stdout.resume();worker.stderr.resume();
  const finish=(r:PdfResult)=>{if(settled)return;settled=true;clearTimeout(timer);worker.terminate().catch(()=>{});resolve(r);};
  const timer=setTimeout(()=>finish({ok:false,category:'timeout'}),options.timeoutMs??LIMITS.workerTimeoutMs);
  worker.once('message',m=>finish(accept(m,limits)));
  worker.once('error',e=>finish({ok:false,category:(e as any)?.code==='ERR_WORKER_OUT_OF_MEMORY'?'resource-limit':'crash'}));
  worker.once('exit',()=>finish({ok:false,category:'crash'}));
 });
}
