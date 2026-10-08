import {PARTS,type Part} from '../src/domain.ts';
import {measureResponse} from '../src/sourceEvidence.ts';
import {Store,AcquisitionGuardError,ArchiveImportConflictError,ScanBusyError,hash,type AcquisitionMeta,type FailureCategory} from './store.ts';
// Ordinary public calendar retrieval for the two demonstrated Town feeds only. One identified GET per part, redirect:error,
// one timeout covering headers and body, 2 MB advertised/streamed bounds, no retries, no new hosts, sessions or credentials.
// Failed bodies are never returned or persisted; failures carry fixed categories and actually observed transport fields only.
export const USER_AGENT='HomeschoolCollector-LocalPreview/0.1 (ordinary public calendar check)';
export const LIMITS={timeoutMs:15_000,maxBytes:2_000_000};
export type Fetcher=(url:string,init:RequestInit)=>Promise<Response>;
export interface RetrieveOptions {fetch?:Fetcher;now?:()=>Date;timeoutMs?:number;maxBytes?:number;runtime?:string}
export type Retrieval={ok:true;body:string;meta:AcquisitionMeta}|{ok:false;meta:AcquisitionMeta};
const MEDIA=/^[a-z0-9!#$&^_.+-]{1,60}\/[a-z0-9!#$&^_.+-]{1,60}$/;
const mediaType=(value:string|null)=>{if(value===null)return null;const media=value.split(';')[0].trim().toLowerCase();return MEDIA.test(media)?media:'unrecognized';};
class Stop extends Error {constructor(readonly category:FailureCategory){super(category);}}
export async function retrieve(part:Part,options:RetrieveOptions={}):Promise<Retrieval>{
 if(!Object.hasOwn(PARTS,part))throw Error('Unknown source part.');
 const url=PARTS[part].url,fetcher=options.fetch??globalThis.fetch,now=options.now??(()=>new Date());
 const maxBytes=options.maxBytes??LIMITS.maxBytes,timeoutMs=options.timeoutMs??LIMITS.timeoutMs;
 const meta:AcquisitionMeta={method:'ordinary-get',startedAt:now().toISOString(),completedAt:null,runtime:options.runtime??process.version,status:null,contentType:null,bytes:null,advertisedBytes:null,category:null};
 const controller=new AbortController(),signal=controller.signal;
 const timer=setTimeout(()=>controller.abort(new DOMException('Source check timed out.','TimeoutError')),timeoutMs);
 let response:Response|null=null,reader:ReadableStreamDefaultReader<Uint8Array>|null=null,stage:'fetch'|'read'='fetch';
 const cancelOnAbort=()=>{reader?.cancel(signal.reason).catch(()=>{});};
 try{
  // The timeout bounds the header wait even if a fetch implementation ignored its signal.
  const aborted=new Promise<never>((_,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));aborted.catch(()=>{});
  response=await Promise.race([fetcher(url,{method:'GET',redirect:'error',signal,headers:{Accept:'text/calendar','User-Agent':USER_AGENT}}),aborted]);
  meta.status=response.status;meta.contentType=mediaType(response.headers.get('content-type'));
  const advertised=response.headers.get('content-length');if(advertised!==null&&/^\d{1,15}$/.test(advertised.trim()))meta.advertisedBytes=Number(advertised.trim());
  if(response.status===401||response.status===403)throw new Stop('denied');
  if(response.status===429)throw new Stop('rate-limited');
  if(!response.ok)throw new Stop('http-status');
  if(meta.advertisedBytes!==null&&meta.advertisedBytes>maxBytes)throw new Stop('too-large');
  if(!response.body)throw new Stop('no-body');
  stage='read';reader=response.body.getReader();signal.addEventListener('abort',cancelOnAbort,{once:true});
  const chunks:Uint8Array[]=[];let bytes=0;
  while(true){
   const r=await reader.read();
   // A cancelled read can resolve as done; the request signal, not the stream, decides whether this was a timeout.
   if(signal.aborted)throw signal.reason;
   if(r.done)break;
   bytes+=r.value.byteLength;if(bytes>maxBytes)throw new Stop('too-large');chunks.push(r.value);
  }
  reader.releaseLock();reader=null;
  const body=Buffer.concat(chunks).toString('utf8');meta.bytes=bytes;
  if(!body.trimStart().startsWith('BEGIN:VCALENDAR')||!body.includes('END:VCALENDAR'))throw new Stop('not-calendar');
  meta.completedAt=now().toISOString();
  return {ok:true,body,meta};
 }catch(e){
  // The same request signal decides timeout first; otherwise a fetch rejection (including redirect:error) is transport-error.
  meta.category=e instanceof Stop?e.category:signal.aborted&&(signal.reason as any)?.name==='TimeoutError'?'timeout':stage==='fetch'?'transport-error':'stream-error';
  meta.completedAt=now().toISOString();
  return {ok:false,meta};
 }finally{
  clearTimeout(timer);signal.removeEventListener('abort',cancelOnAbort);
  // Release the connection on every early exit: cancel the locked reader, or the unread body.
  if(reader){await reader.cancel().catch(()=>{});try{reader.releaseLock();}catch{}}
  else if(response?.body&&!response.bodyUsed&&!response.body.locked)await response.body.cancel().catch(()=>{});
 }
}
// Safe, bounded per-part scan result for lastScan and /api/scan: fixed categories/status/counts only, no bodies, receipts,
// parser reason strings or exception messages.
export type ScanResult={part:Part;ok:boolean;persisted:boolean;outcome:string;attemptId?:string;category?:string|null;status?:number|null;returned?:number;accepted?:number;parserRejects?:number;duplicates?:number};
const summary=(part:Part,r:any):ScanResult=>({part,ok:r.outcome!=='failed',persisted:true,outcome:r.outcome,attemptId:r.attemptId,...(r.outcome==='failed'?{category:r.category,status:r.status}:{returned:r.returned,accepted:r.accepted,parserRejects:r.parserRejects,duplicates:r.duplicates})});
const unpersisted=(part:Part,e:unknown):ScanResult=>({part,ok:false,persisted:false,outcome:e instanceof AcquisitionGuardError?'superseded':'internal-error'});
export class SourceChecker {
 scanning=false;lastScan:{finishedAt:string;results:ScanResult[]}|null=null;
 constructor(readonly store:Store,readonly options:RetrieveOptions={}){}
 state(){return {scanning:this.scanning,lastScan:this.lastScan};}
 async scan(){
  if(this.scanning)throw new ScanBusyError('Scan already in progress.');
  const token=this.store.beginScan();this.scanning=true;const results:ScanResult[]=[];
  try{
   for(const part of Object.keys(PARTS) as Part[]){
    let retrieval:Retrieval;
    try{retrieval=await retrieve(part,this.options);}catch(e){results.push(unpersisted(part,e));continue;}
    // Whole-response parser rejection is decided before any completion, so a success completion is never followed by a
    // failure completion for the same part.
    if(retrieval.ok){try{measureResponse(retrieval.body,hash);}catch{retrieval={ok:false,meta:{...retrieval.meta,category:'parse-error'}};}}
    try{
     const now=Date.now();
     const result=retrieval.ok?this.store.completeSuccess({part,fence:token.fence,origin:'live',body:retrieval.body,observedAt:new Date(now).toISOString(),acquisition:retrieval.meta,now}):this.store.completeFailure({part,fence:token.fence,acquisition:retrieval.meta,now});
     results.push(summary(part,result));
    }catch(e){results.push(unpersisted(part,e));}
   }
   this.lastScan={finishedAt:new Date().toISOString(),results};return this.lastScan;
  }finally{this.store.endScan(token.fence);this.scanning=false;}
 }
}
// Startup import of the dated public archives through the explicit archived completion wrapper. A fixed-batch receipt that
// matches is returned as non-acquisition evidence; a mismatched one is a typed conflict reported safely while the server
// continues with retained data. Guard rejections are reported, not masked; any other failure is a real error.
export function importArchives(store:Store,read:(part:Part)=>string,capturedAt:string,now=Date.now()){
 const token=store.beginScan(now),results:{part:Part;status:string;attemptId?:string}[]=[];
 try{
  for(const part of Object.keys(PARTS) as Part[]){
   try{const r=store.recordArchived({part,body:read(part),observedAt:capturedAt,batchId:`initial-fixture-${part}`,fence:token.fence,now});results.push({part,status:r.status,...(r.attemptId?{attemptId:r.attemptId}:{})});}
   catch(e){if(e instanceof ArchiveImportConflictError)results.push({part,status:'archive-import-conflict'});else if(e instanceof AcquisitionGuardError)results.push({part,status:'superseded'});else throw e;}
  }
 }finally{store.endScan(token.fence);}
 return results;
}
