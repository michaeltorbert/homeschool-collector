import test from 'node:test';
import assert from 'node:assert/strict';
import {fetchBounded,type Fetcher} from '../server/documents/fetch.ts';
import {LIMITS,USER_AGENT} from '../server/documents/policy.ts';
// SYNTHETIC injected transport; nothing leaves the process.
const URL_PDF='https://www.fuquay-varina.org/DocumentCenter/View/1/x';
const PDF=Buffer.from('%PDF-1.4\nsynthetic');
const fixed=(res:()=>Response):Fetcher=>async()=>res();
// A body stream that records cancellation and can stall or exceed limits. With stall=true it stays open after its chunks
// (never closes on its own), so only consumer cancellation can end it; a self-closing source may already be closed by
// read-ahead when the overflow is detected, and cancelling a closed stream does not reach the underlying source.
function tracked(chunks:Uint8Array[],stall=false){
 const state={cancelled:false};
 const body=new ReadableStream<Uint8Array>({pull(c){if(chunks.length)c.enqueue(chunks.shift()!);else if(!stall)c.close();else return new Promise(()=>{});},cancel(){state.cancelled=true;}});
 return {body,state};
}
test('one identified ordinary GET with redirect:error, no credentials, correct Accept; 200 PDF passes magic check',async()=>{
 const seen:any[]=[];
 const r=await fetchBounded(URL_PDF,'pdf',{fetch:async(u,init)=>{seen.push({u,init});return new Response(PDF,{headers:{'content-type':'application/pdf','etag':'"v1"','last-modified':'Tue, 06 Oct 2026 12:00:00 GMT'}});}});
 assert.equal(seen.length,1);assert.equal(seen[0].u,URL_PDF);
 assert.equal(seen[0].init.redirect,'error');assert.equal(seen[0].init.method,'GET');assert.equal(seen[0].init.credentials,'omit');
 assert.deepEqual(seen[0].init.headers,{Accept:'application/pdf','User-Agent':USER_AGENT});
 assert.ok(r.ok&&!r.notModified&&r.body.equals(PDF));
 assert.equal(r.meta.etag,'"v1"');assert.equal(r.meta.lastModified,'Tue, 06 Oct 2026 12:00:00 GMT');assert.equal(r.meta.bytes,PDF.length);
});
test('status, challenge, MIME, magic and redirect failures map to fixed categories without bodies',async()=>{
 const cases:[Fetcher,string,'pdf'|'html'|'robots'][]=[
  [fixed(()=>new Response('SENTINEL',{status:401})),'denied','pdf'],[fixed(()=>new Response('SENTINEL',{status:403})),'denied','html'],
  [fixed(()=>new Response('SENTINEL',{status:403,headers:{'cf-mitigated':'challenge'}})),'challenge','html'],
  [fixed(()=>new Response('SENTINEL',{status:503,headers:{'cf-mitigated':'challenge'}})),'challenge','robots'],
  [fixed(()=>new Response('SENTINEL',{status:503})),'server-error','pdf'],[fixed(()=>new Response('SENTINEL',{status:404})),'http-status','robots'],
  [fixed(()=>new Response('SENTINEL',{status:206,headers:{'content-type':'application/pdf'}})),'http-status','pdf'],
  [fixed(()=>new Response('<html>SENTINEL</html>',{headers:{'content-type':'text/html'}})),'html-instead-of-pdf','pdf'],
  [fixed(()=>new Response('<!doctype html>SENTINEL',{headers:{'content-type':'application/pdf'}})),'html-instead-of-pdf','pdf'],
  [fixed(()=>new Response('GIF89a SENTINEL',{headers:{'content-type':'application/pdf'}})),'not-pdf','pdf'],
  [fixed(()=>new Response('SENTINEL',{headers:{'content-type':'application/octet-stream'}})),'wrong-type','pdf'],
  [fixed(()=>new Response('<html>SENTINEL</html>',{headers:{'content-type':'text/html'}})),'wrong-type','robots'],
  [fixed(()=>new Response('<html><title>Just a moment...</title>SENTINEL</html>',{headers:{'content-type':'text/html'}})),'challenge','html'],
  [fixed(()=>new Response(null,{headers:{'content-type':'application/pdf'}})),'no-body','pdf'],
  [async()=>{throw new TypeError('fetch failed: redirect SENTINEL');},'transport-error','html'],
 ];
 for(const [f,category,kind] of cases){
  const r=await fetchBounded(URL_PDF,kind,{fetch:f});
  assert.equal(r.ok,false,category);assert.equal(r.meta.category,category);assert.equal(JSON.stringify(r).includes('SENTINEL'),false);
 }
});
test('429 records a bounded Retry-After; 304 needs a conditional request and matching validators',async()=>{
 const now=Date.parse('2080-01-01T00:00:00Z');
 const secs=await fetchBounded(URL_PDF,'pdf',{now:()=>now,fetch:fixed(()=>new Response('',{status:429,headers:{'retry-after':'120'}}))});
 assert.equal(secs.meta.category,'rate-limited');assert.equal(secs.meta.retryAfterMs,120_000);
 const date=await fetchBounded(URL_PDF,'pdf',{now:()=>now,fetch:fixed(()=>new Response('',{status:429,headers:{'retry-after':'Mon, 01 Jan 2080 01:00:00 GMT'}}))});
 assert.equal(date.meta.retryAfterMs,3_600_000);
 const junk=await fetchBounded(URL_PDF,'pdf',{fetch:fixed(()=>new Response('',{status:429,headers:{'retry-after':'x'.repeat(100)}}))});
 assert.equal(junk.meta.retryAfterMs,null);
 assert.equal((await fetchBounded(URL_PDF,'pdf',{fetch:fixed(()=>new Response(null,{status:304}))})).meta.category,'unexpected-not-modified');
 let sent:any=null;
 const ok=await fetchBounded(URL_PDF,'pdf',{validators:{etag:'"v1"',lastModified:null},fetch:async(_u,init)=>{sent=init.headers;return new Response(null,{status:304,headers:{etag:'"v1"'}});}});
 assert.ok(ok.ok&&ok.notModified);assert.equal(sent['If-None-Match'],'"v1"');assert.equal(sent['If-Modified-Since'],undefined);
 const other=await fetchBounded(URL_PDF,'pdf',{validators:{etag:'"v1"',lastModified:null},fetch:fixed(()=>new Response(null,{status:304,headers:{etag:'"v2"'}}))});
 assert.equal(other.meta.category,'unexpected-not-modified');
 const bad=await fetchBounded(URL_PDF,'pdf',{fetch:fixed(()=>new Response(PDF,{headers:{'content-type':'application/pdf',etag:`"${'x'.repeat(300)}"`,'last-modified':'yesterday'}}))});
 assert.ok(bad.ok);assert.equal(bad.meta.etag,null);assert.equal(bad.meta.lastModified,null);
});
test('advertised and streamed caps cancel the reader; the run budget can lower the cap',async()=>{
 const big=await fetchBounded(URL_PDF,'pdf',{fetch:fixed(()=>new Response(PDF,{headers:{'content-type':'application/pdf','content-length':String(LIMITS.pdfBytes+1)}}))});
 assert.equal(big.meta.category,'too-large');
 // Overflowing sources stay open, so the observed cancellation can only come from the transport stopping the read.
 const html=tracked([new Uint8Array(LIMITS.htmlBytes),new Uint8Array(10)],true);
 const streamed=await fetchBounded(URL_PDF,'html',{fetch:fixed(()=>new Response(html.body,{headers:{'content-type':'text/html'}}))});
 assert.equal(streamed.meta.category,'too-large');assert.equal(html.state.cancelled,true);
 const budget=tracked([PDF,new Uint8Array(100)],true);
 const capped=await fetchBounded(URL_PDF,'pdf',{maxBytes:50,fetch:fixed(()=>new Response(budget.body,{headers:{'content-type':'application/pdf'}}))});
 assert.equal(capped.meta.category,'too-large');assert.equal(budget.state.cancelled,true);
});
test('one timeout covers headers and a stalled body; shutdown cancellation is distinct',async()=>{
 const headers=await fetchBounded(URL_PDF,'pdf',{timeoutMs:50,fetch:()=>new Promise<Response>(()=>{})});
 assert.equal(headers.meta.category,'timeout');assert.equal(headers.meta.status,null);
 const stall=tracked([PDF],true);
 const body=await fetchBounded(URL_PDF,'pdf',{timeoutMs:50,fetch:fixed(()=>new Response(stall.body,{headers:{'content-type':'application/pdf'}}))});
 assert.equal(body.meta.category,'timeout');assert.equal(body.meta.status,200);assert.equal(stall.state.cancelled,true);
 const stop=new AbortController();stop.abort();let called=false;
 const cancelled=await fetchBounded(URL_PDF,'pdf',{signal:stop.signal,fetch:async()=>{called=true;return new Response(PDF);}});
 assert.equal(cancelled.meta.category,'cancelled');assert.equal(called,false);
});
