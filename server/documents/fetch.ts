import {LIMITS,USER_AGENT,looksLikeChallenge} from './policy.ts';
// Dedicated bounded binary transport for robots/seed HTML/brochure PDFs. The calendar retriever is unchanged.
// One identified ordinary GET: redirect:'error', no credentials/cookies/retries, one timeout covering headers and body,
// advertised and streamed byte caps, MIME/magic validation and reader cancellation on every early exit.
// Failures carry fixed categories and observed transport fields only; failed bodies are never returned.
export type FetchKind='robots'|'html'|'pdf';
export const FETCH_CATEGORIES=['denied','challenge','rate-limited','server-error','http-status','transport-error','timeout','cancelled','too-large','no-body','stream-error','wrong-type','html-instead-of-pdf','not-pdf','unexpected-not-modified'] as const;
export type FetchCategory=typeof FETCH_CATEGORIES[number];
export type Fetcher=(url:string,init:RequestInit)=>Promise<Response>;
export interface Validators {etag:string|null;lastModified:string|null}
export interface FetchMeta {url:string;startedAt:string;completedAt:string|null;status:number|null;contentType:string|null;bytes:number|null;advertisedBytes:number|null;etag:string|null;lastModified:string|null;retryAfterMs:number|null;category:FetchCategory|null}
export type FetchResult={ok:true;notModified:false;body:Buffer;meta:FetchMeta}|{ok:true;notModified:true;meta:FetchMeta}|{ok:false;meta:FetchMeta};
export interface FetchOptions {fetch?:Fetcher;signal?:AbortSignal;now?:()=>number;timeoutMs?:number;maxBytes?:number;validators?:Validators|null}
const ACCEPT:Record<FetchKind,string>={robots:'text/plain',html:'text/html',pdf:'application/pdf'};
const MEDIA=/^[a-z0-9!#$&^_.+-]{1,60}\/[a-z0-9!#$&^_.+-]{1,60}$/;
const mediaType=(v:string|null)=>{if(v===null)return null;const m=v.split(';')[0].trim().toLowerCase();return MEDIA.test(m)?m:'unrecognized';};
// Validators are kept only when bounded and well-formed, so a conditional request never replays arbitrary header text.
export const validEtag=(v:string|null)=>v!==null&&/^(?:W\/)?"[\x21\x23-\x7e]{0,200}"$/.test(v)?v:null;
export const validLastModified=(v:string|null)=>v!==null&&/^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(v)&&Number.isFinite(Date.parse(v))?v:null;
export function retryAfterMs(v:string|null,now:number):number|null{
 if(v===null)return null;const t=v.trim();
 if(/^\d{1,9}$/.test(t))return Number(t)*1000;
 const d=Date.parse(t);return t.length<=64&&Number.isFinite(d)?Math.max(0,d-now):null;
}
class Stop extends Error {constructor(readonly category:FetchCategory){super(category);}}
export async function fetchBounded(url:string,kind:FetchKind,options:FetchOptions={}):Promise<FetchResult>{
 const fetcher=options.fetch??globalThis.fetch,now=options.now??Date.now,timeoutMs=options.timeoutMs??LIMITS.timeoutMs;
 const maxBytes=Math.min(options.maxBytes??Infinity,kind==='pdf'?LIMITS.pdfBytes:kind==='html'?LIMITS.htmlBytes:LIMITS.robotsBytes);
 const meta:FetchMeta={url,startedAt:new Date(now()).toISOString(),completedAt:null,status:null,contentType:null,bytes:null,advertisedBytes:null,etag:null,lastModified:null,retryAfterMs:null,category:null};
 const timeout=new AbortController();
 const timer=setTimeout(()=>timeout.abort(new DOMException('Request timed out.','TimeoutError')),timeoutMs);
 const signal=options.signal?AbortSignal.any([timeout.signal,options.signal]):timeout.signal;
 let response:Response|null=null,reader:ReadableStreamDefaultReader<Uint8Array>|null=null,stage:'fetch'|'read'='fetch';
 const cancelOnAbort=()=>{reader?.cancel().catch(()=>{});};
 const conditional=!!(options.validators&&(options.validators.etag||options.validators.lastModified));
 try{
  if(signal.aborted)throw signal.reason;
  const headers:Record<string,string>={Accept:ACCEPT[kind],'User-Agent':USER_AGENT};
  if(conditional){if(options.validators!.etag)headers['If-None-Match']=options.validators!.etag;if(options.validators!.lastModified)headers['If-Modified-Since']=options.validators!.lastModified;}
  const aborted=new Promise<never>((_,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));aborted.catch(()=>{});
  response=await Promise.race([fetcher(url,{method:'GET',redirect:'error',credentials:'omit',signal,headers}),aborted]);
  meta.status=response.status;meta.contentType=mediaType(response.headers.get('content-type'));
  const advertised=response.headers.get('content-length');if(advertised!==null&&/^\d{1,15}$/.test(advertised.trim()))meta.advertisedBytes=Number(advertised.trim());
  const challenged=response.headers.has('cf-mitigated');
  // A 304 is accepted only for a conditional request built from a retained representation, and only when any returned
  // ETag matches the one sent.
  if(response.status===304){const etag=response.headers.get('etag');if(!conditional||(etag!==null&&options.validators!.etag!==null&&etag!==options.validators!.etag))throw new Stop('unexpected-not-modified');meta.completedAt=new Date(now()).toISOString();return {ok:true,notModified:true,meta};}
  if(response.status===401||response.status===403)throw new Stop(challenged?'challenge':'denied');
  if(response.status===429){meta.retryAfterMs=retryAfterMs(response.headers.get('retry-after'),now());throw new Stop('rate-limited');}
  if(challenged)throw new Stop('challenge');
  if(response.status>=500)throw new Stop('server-error');
  if(response.status!==200)throw new Stop('http-status');
  if(kind==='pdf'&&meta.contentType==='text/html')throw new Stop('html-instead-of-pdf');
  if(meta.contentType!==ACCEPT[kind])throw new Stop('wrong-type');
  if(meta.advertisedBytes!==null&&meta.advertisedBytes>maxBytes)throw new Stop('too-large');
  if(!response.body)throw new Stop('no-body');
  stage='read';reader=response.body.getReader();signal.addEventListener('abort',cancelOnAbort,{once:true});
  const chunks:Uint8Array[]=[];let bytes=0;
  while(true){
   const r=await reader.read();
   if(signal.aborted)throw signal.reason;
   if(r.done)break;
   bytes+=r.value.byteLength;if(bytes>maxBytes)throw new Stop('too-large');chunks.push(r.value);
  }
  reader.releaseLock();reader=null;
  const body=Buffer.concat(chunks,bytes);meta.bytes=bytes;
  if(kind==='pdf'&&body.subarray(0,5).toString('latin1')!=='%PDF-')throw new Stop(/^\s*</.test(body.subarray(0,64).toString('latin1'))?'html-instead-of-pdf':'not-pdf');
  if(kind==='html'&&looksLikeChallenge(body.toString('utf8')))throw new Stop('challenge');
  meta.etag=validEtag(response.headers.get('etag'));meta.lastModified=validLastModified(response.headers.get('last-modified'));
  meta.completedAt=new Date(now()).toISOString();
  return {ok:true,notModified:false,body,meta};
 }catch(e){
  meta.category=e instanceof Stop?e.category:timeout.signal.aborted?'timeout':options.signal?.aborted?'cancelled':stage==='fetch'?'transport-error':'stream-error';
  meta.completedAt=new Date(now()).toISOString();
  return {ok:false,meta};
 }finally{
  clearTimeout(timer);signal.removeEventListener('abort',cancelOnAbort);
  if(reader){await reader.cancel().catch(()=>{});try{reader.releaseLock();}catch{}}
  else if(response?.body&&!response.bodyUsed&&!response.body.locked)await response.body.cancel().catch(()=>{});
 }
}
