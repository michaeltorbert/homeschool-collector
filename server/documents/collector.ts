import {LIMITS,ROBOTS_URL,SEEDS,parseRobots,robotsAllows,linkInventory,sha256,type LinkInventory,type RobotsPolicy} from './policy.ts';
import {fetchBounded,type Fetcher,type FetchKind,type FetchResult,type Validators} from './fetch.ts';
import {extractPdf,type PdfResult} from './pdf.ts';
import {analyzeDocument,PARSER_REVISION} from './layout.ts';
import {DocumentStore,QuotaError,StaleFenceError} from './store.ts';
// Automatic public brochure collection. Every network step happens only inside a persisted admission (fence + lease +
// next-due committed first), is preceded by a persisted pacing reservation, and follows robots.txt fetched in the same
// run. Sticky stops (denial, challenge, HTML instead of PDF, robots prohibition/unavailability/unsupported policy) block
// the whole Town lane until a person changes the code; there is no force, clear or reset path. GET routes never call this.
// No AI or model provider is involved; extraction is deterministic local code.
export type Trigger='startup'|'timer'|'cli';
export interface CollectorOptions {fetch?:Fetcher;now?:()=>number;sleep?:(ms:number,signal:AbortSignal)=>Promise<void>;extract?:(bytes:Uint8Array)=>Promise<PdfResult>;log?:(line:string)=>void}
type Effect='continue'|'stop';
const STICKY=new Set(['denied','challenge','html-instead-of-pdf']);
const TRANSIENT=new Set(['server-error','transport-error','timeout','cancelled','stream-error']);
const defaultSleep=(ms:number,signal:AbortSignal)=>new Promise<void>(resolve=>{if(signal.aborted){resolve();return;}const t=setTimeout(done,ms);function done(){clearTimeout(t);signal.removeEventListener('abort',done);resolve();}signal.addEventListener('abort',done,{once:true});});
export class DocumentCollector {
 private controller=new AbortController();
 private running:Promise<any>|null=null;
 private timer:ReturnType<typeof setInterval>|null=null;
 constructor(readonly store:DocumentStore,readonly options:CollectorOptions={}){}
 private now(){return (this.options.now??Date.now)();}
 private log(line:string){(this.options.log??console.log)(line);}
 // Automatic operation: one due check at start, then a small unref'd timer that only asks the persisted gate.
 start(intervalMs=3_600_000){
  this.tick('startup');
  this.timer=setInterval(()=>this.tick('timer'),intervalMs);this.timer.unref();
 }
 private tick(trigger:Trigger){
  this.runIfDue(trigger).then(r=>{if(r.admitted)this.log(`Document check ${r.fence}: ${r.outcome}${r.stoppedBy?` (${r.stoppedBy})`:''}`);})
   .catch(()=>this.log('Document check could not run; retained evidence is unchanged.'));
 }
 async stop(){
  if(this.timer)clearInterval(this.timer);this.timer=null;this.controller.abort();
  await this.running?.catch(()=>{});
 }
 runIfDue(trigger:Trigger):Promise<any>{
  if(this.running)return Promise.resolve({admitted:false,reason:'busy'});
  if(this.controller.signal.aborted)return Promise.resolve({admitted:false,reason:'stopped'});
  const p=this.run(trigger).finally(()=>{this.running=null;});
  this.running=p;return p;
 }
 private async run(trigger:Trigger){
  const adm=this.store.admit(this.now(),trigger);
  if(!adm.admitted)return adm;
  const fence=adm.fence;
  const report:any={admitted:true,fence,trigger,outcome:'complete',stoppedBy:null,robots:null,seeds:[],documents:[],deferred:[],notDue:0,
   coverage:{fullCoverageClaim:false,excludedBrochureLinks:0,seedsWithExcludedBrochures:[] as string[],inventoryTruncatedSeeds:[] as string[],documentLinksOmitted:0,documentIdsOmitted:0}};
  try{
   const policy=await this.robots(fence,report);
   const inventories:LinkInventory[]=[];
   if(policy)for(const seed of SEEDS){if(await this.seed(fence,seed,policy,report,inventories)==='stop')break;}
   if(policy&&!report.stoppedBy)await this.documents(fence,policy,report,inventories);
   if(report.stoppedBy)report.outcome='stopped';
   else if(report.deferred.length||report.coverage.inventoryTruncatedSeeds.length||report.seeds.some((s:any)=>s.outcome==='failed')||report.documents.some((d:any)=>d.outcome==='failed'||d.parseStatus!=='ok'&&d.parseStatus!==undefined))report.outcome='partial';
  }catch(e){
   report.outcome=e instanceof StaleFenceError?'superseded':'internal-error';
  }finally{
   try{this.store.finishRun(fence,report,this.now());}catch{}
  }
  return report;
 }
 // Persisted pacing reservation before every request; aliases and new documents share the one Town lane clock.
 private async request(fence:number,url:string,kind:FetchKind,validators:Validators|null,maxBytes?:number):Promise<FetchResult>{
  const sleep=this.options.sleep??defaultSleep;
  while(true){
   if(this.controller.signal.aborted)break;
   const wait=this.store.reserveRequest(fence,this.now());
   if(wait===0)break;
   await sleep(wait,this.controller.signal);
  }
  return fetchBounded(url,kind,{fetch:this.options.fetch,signal:this.controller.signal,now:()=>this.now(),validators,maxBytes});
 }
 private effect(category:string,retryAfterMs:number|null,report:any):Effect{
  const now=this.now();
  if(STICKY.has(category)){this.store.block(category,now);report.stoppedBy=category;return 'stop';}
  if(category==='rate-limited'){this.store.backoff(now+Math.min(LIMITS.rateLimitMaxMs,Math.max(LIMITS.rateLimitMinMs,retryAfterMs??0)));report.stoppedBy='rate-limited';return 'stop';}
  if(TRANSIENT.has(category)){report.stoppedBy=category;return 'stop';}
  return 'continue';
 }
 private enoughLease(fence:number,report:any){
  if(this.store.leaseRemaining(fence,this.now())>=LIMITS.leaseReserveMs+LIMITS.timeoutMs+LIMITS.workerTimeoutMs)return true;
  report.stoppedBy='lease-exhausted';return false;
 }
 private async robots(fence:number,report:any):Promise<RobotsPolicy&{ok:true}|null>{
  const src=this.store.source('robots');
  if(!this.enoughLease(fence,report))return null;
  const r=await this.request(fence,ROBOTS_URL,'robots',null);
  if(!r.ok||r.notModified){
   const category=r.ok?'unexpected-not-modified':r.meta.category!;
   this.store.complete({fence,sourceId:src.id,url:ROBOTS_URL,now:this.now(),meta:r.meta,outcome:'failed',category});
   report.robots={outcome:'failed',category,status:r.meta.status};
   // Robots 404/other 4xx/wrong type/oversize fail closed and stick; 5xx/timeouts abort this run only. No permission is
   // ever inferred from a missing or failed robots.txt.
   if(STICKY.has(category)||category==='rate-limited'||TRANSIENT.has(category))this.effect(category,r.ok?null:r.meta.retryAfterMs,report);
   else{this.store.block('robots-unavailable',this.now());report.stoppedBy='robots-unavailable';}
   return null;
  }
  let text:string|null=null;try{text=new TextDecoder('utf-8',{fatal:true}).decode(r.body);}catch{}
  const policy=text===null?{ok:false as const,reason:'malformed' as const}:parseRobots(text);
  const latest=this.store.latestVersion(src.id),rawSha=sha256(r.body);
  const same=latest&&latest.raw_sha256===rawSha;
  this.store.complete({fence,sourceId:src.id,url:ROBOTS_URL,now:this.now(),meta:r.meta,outcome:same?'unchanged':'new-version',category:null,
   ...(same?{versionId:Number(latest.id)}:{version:{rawSha256:rawSha,rawBytes:r.body.byteLength,body:r.body,storedKind:'robots-text',contentType:'text/plain',etag:null,lastModified:null}})});
  if(!policy.ok){this.store.block('robots-unsupported',this.now());report.robots={outcome:'unsupported',reason:policy.reason};report.stoppedBy='robots-unsupported';return null;}
  if(policy.crawlDelayMs!==null)this.store.setRequestGap(fence,policy.crawlDelayMs,this.now());
  report.robots={outcome:same?'unchanged':'new-version',group:policy.group,crawlDelayMs:policy.crawlDelayMs};
  return policy;
 }
 private disallowed(url:string,policy:RobotsPolicy,report:any){
  if(robotsAllows(policy,new URL(url).pathname))return false;
  this.store.block('robots-disallow',this.now());report.stoppedBy='robots-disallow';return true;
 }
 private async seed(fence:number,seed:typeof SEEDS[number],policy:RobotsPolicy,report:any,inventories:LinkInventory[]):Promise<Effect>{
  const src=this.store.source(seed.key);
  if(this.disallowed(seed.url,policy,report)||!this.enoughLease(fence,report))return 'stop';
  const cond=this.store.conditionalFor(src.id);
  const r=await this.request(fence,seed.url,'html',cond);
  const entry:any={key:seed.key};report.seeds.push(entry);
  if(!r.ok){
   entry.outcome='failed';entry.category=r.meta.category;entry.status=r.meta.status;
   this.store.complete({fence,sourceId:src.id,url:seed.url,now:this.now(),meta:r.meta,outcome:'failed',category:r.meta.category});
   return this.effect(r.meta.category!,r.meta.retryAfterMs,report);
  }
  let inventory:LinkInventory;
  if(r.notModified){
   inventory=JSON.parse(this.store.blob(cond!.versionId)!.toString('utf8'));
   this.store.complete({fence,sourceId:src.id,url:seed.url,now:this.now(),meta:r.meta,outcome:'not-modified',category:null,versionId:cond!.versionId,inventory});
   entry.outcome='not-modified';
  }else{
   // Only the sanitized link inventory is stored: no scripts, queries, tokens or off-host URLs beyond a host name.
   inventory=linkInventory(r.body.toString('utf8'),seed.url);
   const stored=Buffer.from(JSON.stringify(inventory)),latest=this.store.latestVersion(src.id);
   const same=latest&&latest.stored_sha256===sha256(stored);
   this.store.complete({fence,sourceId:src.id,url:seed.url,now:this.now(),meta:r.meta,outcome:same?'unchanged':'new-version',category:null,inventory,
    ...(same?{versionId:Number(latest.id)}:{version:{rawSha256:sha256(r.body),rawBytes:r.body.byteLength,body:stored,storedKind:'sanitized-link-inventory',contentType:'text/html',etag:r.meta.etag,lastModified:r.meta.lastModified}})});
   entry.outcome=same?'unchanged':'new-version';
  }
  entry.documentLinks=inventory.documents.length;entry.excludedBrochureLinks=inventory.excluded.length;
  // A bounded inventory that dropped links is reported explicitly and makes the run partial; omitted documents cannot
  // be collected or deferred because their URLs are not retained.
  if(inventory.truncated){
   Object.assign(entry,{inventoryTruncated:true,truncatedReasons:inventory.truncatedReasons??[],documentLinksOmitted:inventory.counts.documentLinksOmitted??0,documentIdsOmitted:inventory.counts.documentIdsOmitted??0});
   report.coverage.inventoryTruncatedSeeds.push(seed.key);report.coverage.documentLinksOmitted+=entry.documentLinksOmitted;report.coverage.documentIdsOmitted+=entry.documentIdsOmitted;
  }
  // Zero document links never cancels or removes known documents; it is reported as observed.
  if(inventory.excluded.length){report.coverage.excludedBrochureLinks+=inventory.excluded.length;report.coverage.seedsWithExcludedBrochures.push(seed.key);}
  inventories.push(inventory);
  return 'continue';
 }
 private async documents(fence:number,policy:RobotsPolicy,report:any,inventories:LinkInventory[]){
  const linked=new Map<number,string>();
  for(const inv of inventories)for(const d of inv.documents)if(!linked.has(d.docId))linked.set(d.docId,d.url);
  const due:{src:any;url:string}[]=[];
  for(const [docId,url] of linked){
   const src=this.store.source(`doc:${docId}`);
   if(this.store.isDue(src.id,LIMITS.pdfDueMs,this.now()))due.push({src,url});else report.notDue++;
  }
  let count=0,bytes=0;
  for(const {src,url} of due){
   if(count>=LIMITS.runPdfCount||LIMITS.runPdfBytes-bytes<LIMITS.pdfBytes){report.deferred.push({docId:src.doc_id,reason:count>=LIMITS.runPdfCount?'run-pdf-count':'run-byte-budget'});continue;}
   if(this.disallowed(url,policy,report)||!this.enoughLease(fence,report))return;
   const cond=this.store.conditionalFor(src.id);
   const r=await this.request(fence,url,'pdf',cond,LIMITS.runPdfBytes-bytes);
   count++;bytes+=r.ok&&!r.notModified?r.body.byteLength:0;
   const entry:any={docId:src.doc_id};report.documents.push(entry);
   if(!r.ok){
    entry.outcome='failed';entry.category=r.meta.category;entry.status=r.meta.status;
    this.store.complete({fence,sourceId:src.id,url,now:this.now(),meta:r.meta,outcome:'failed',category:r.meta.category});
    if(this.effect(r.meta.category!,r.meta.retryAfterMs,report)==='stop')return;
    continue;
   }
   if(r.notModified){this.store.complete({fence,sourceId:src.id,url,now:this.now(),meta:r.meta,outcome:'not-modified',category:null,versionId:cond!.versionId});entry.outcome='not-modified';continue;}
   const rawSha=sha256(r.body),latest=this.store.latestVersion(src.id);
   // Unchanged bytes are a verification only; extraction is not repeated.
   if(latest&&latest.raw_sha256===rawSha){this.store.complete({fence,sourceId:src.id,url,now:this.now(),meta:r.meta,outcome:'unchanged',category:null,versionId:Number(latest.id)});entry.outcome='unchanged';continue;}
   // Publisher rollback to bytes still retained under an earlier version: that immutable version and its parse become
   // current again with a new attempt; fragment identities are content-bound, so nothing is re-extracted or duplicated.
   const earlier=this.store.retainedVersion(src.id,rawSha);
   if(earlier){this.store.complete({fence,sourceId:src.id,url,now:this.now(),meta:r.meta,outcome:'retained-version',category:null,versionId:Number(earlier.id)});entry.outcome='retained-version';continue;}
   const analysis=analyzeDocument(await (this.options.extract??extractPdf)(r.body),{key:src.key,documentSha256:rawSha});
   try{
    this.store.complete({fence,sourceId:src.id,url,now:this.now(),meta:r.meta,outcome:'new-version',category:null,analysis,
     version:{rawSha256:rawSha,rawBytes:r.body.byteLength,body:r.body,storedKind:'raw-pdf',contentType:'application/pdf',etag:r.meta.etag,lastModified:r.meta.lastModified}});
    Object.assign(entry,{outcome:'new-version',parseStatus:analysis.status,candidates:analysis.candidates.length,errorCategory:analysis.errorCategory});
   }catch(e){
    if(!(e instanceof QuotaError))throw e;
    this.store.complete({fence,sourceId:src.id,url,now:this.now(),meta:r.meta,outcome:'failed',category:'quota-exceeded'});
    Object.assign(entry,{outcome:'failed',category:'quota-exceeded'});
   }
  }
 }
 // Reprocess retained bytes under the current parser revision: new local evidence, no request, no verification time.
 async reparse(){
  const {fence}=this.store.acquireLocal(this.now());const results:any[]=[];
  try{
   for(const src of this.store.documentSources()){
    const v=this.store.latestVersion(src.id);
    if(!v||this.store.hasParse(Number(v.id),PARSER_REVISION)){results.push({docId:src.doc_id,outcome:'current'});continue;}
    const body=this.store.blob(Number(v.id));if(!body){results.push({docId:src.doc_id,outcome:'bytes-not-retained'});continue;}
    const analysis=analyzeDocument(await (this.options.extract??extractPdf)(body),{key:src.key,documentSha256:v.raw_sha256});
    this.store.recordReparse(fence,Number(v.id),analysis,this.now());
    results.push({docId:src.doc_id,outcome:'reparsed',parseStatus:analysis.status,candidates:analysis.candidates.length});
   }
   return {outcome:'complete',parserRevision:PARSER_REVISION,results};
  }finally{this.store.finishRun(fence,{outcome:'local-reparse',results},this.now());}
 }
 // Read-only deterministic replay of the latest retained bytes against the stored parse of the same revision.
 async replay(docId:number){
  const src=this.store.source(`doc:${docId}`);if(!src)return {outcome:'unknown-document'};
  const v=this.store.latestVersion(src.id);if(!v)return {outcome:'no-version'};
  const body=this.store.blob(Number(v.id));if(!body)return {outcome:'bytes-not-retained'};
  if(sha256(body)!==v.raw_sha256)return {outcome:'retained-bytes-mismatch'};
  const analysis=analyzeDocument(await (this.options.extract??extractPdf)(body),{key:src.key,documentSha256:v.raw_sha256});
  const stored=this.store.db.prepare('SELECT id,status FROM parses WHERE version_id=? AND parser_rev=?').get(v.id,PARSER_REVISION) as any;
  if(!stored)return {outcome:'no-current-revision-parse',parserRevision:PARSER_REVISION,replayStatus:analysis.status,replayCandidates:analysis.candidates.length};
  const storedBlocks=(this.store.db.prepare('SELECT id,data_json FROM candidates WHERE parse_id=? ORDER BY ordinal').all(stored.id) as any[]).map(r=>`${r.id}:${JSON.parse(r.data_json).blockSha256}`);
  const replayBlocks=analysis.candidates.map(c=>`${c.id}:${c.blockSha256}`);
  return {outcome:storedBlocks.join()===replayBlocks.join()&&stored.status===analysis.status?'match':'mismatch',parserRevision:PARSER_REVISION,storedStatus:stored.status,replayStatus:analysis.status,storedCandidates:storedBlocks.length,replayCandidates:replayBlocks.length};
 }
}
