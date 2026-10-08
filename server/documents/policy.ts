import {createHash} from 'node:crypto';
import {parse} from 'parse5';
// Public Town brochure collector (issue #7, scope E01): fixed Town seeds, robots-first, exact DocumentCenter links only.
// This is an intermediate public-document collector, not a class/camp catalog, registration or bookable-section adapter.
export const sha256=(v:Uint8Array|string)=>createHash('sha256').update(v).digest('hex');
export const TOWN_HOST='www.fuquay-varina.org';
export const TOWN_ORIGIN=`https://${TOWN_HOST}`;
export const ROBOTS_URL=`${TOWN_ORIGIN}/robots.txt`;
export const SEEDS=[
 {key:'seed:programs',url:`${TOWN_ORIGIN}/311/Programs`},
 {key:'seed:summer-camps',url:`${TOWN_ORIGIN}/328/Summer-Camp-Programs`},
 {key:'seed:dance',url:`${TOWN_ORIGIN}/1088/Dance-Class`},
] as const;
// Robots product token; the User-Agent identifies the collector and its ordinary, unauthenticated behavior.
export const ROBOTS_TOKEN='HomeschoolCollector-Documents';
export const USER_AGENT=`${ROBOTS_TOKEN}/0.1 (local public brochure check; ordinary GET; no registration access)`;
const MiB=1_048_576,DAY=86_400_000;
export const LIMITS={
 timeoutMs:15_000,robotsBytes:MiB,htmlBytes:MiB,pdfBytes:12*MiB,runPdfCount:6,runPdfBytes:72*MiB,
 requestGapMs:5_000,maxCrawlDelayMs:30_000,htmlDueMs:DAY,pdfDueMs:7*DAY,leaseMs:20*60_000,leaseReserveMs:60_000,
 rateLimitMinMs:DAY,rateLimitMaxMs:30*DAY,workerTimeoutMs:30_000,workerHeapMb:192,pages:80,chars:1_000_000,items:100_000,
 attemptsPerSource:100,goodVersionsPerSource:2,totalBlobBytes:200*MiB,runsRetained:100,inventoryDocumentLinks:200,
};
const DOC_PATH=/^\/DocumentCenter\/View\/([1-9]\d{0,8})(?:\/([A-Za-z0-9._~-]{1,200}))?$/;
export type DocLink={docId:number;url:string};
// Accepts only a published HTTPS link on the exact Town host with a numeric DocumentCenter/View path: no credentials,
// port, query, fragment, encoded separators/dots, backslashes or dot segments (rejected before resolution, so traversal
// can never be normalized into an allowed path).
export function documentLink(rawHref:string,base:string):DocLink|null{
 const href=rawHref.trim();
 if(!href||href.length>500||/[\s\\\u0000-\u001f\u007f?#@]/.test(href)||/%(?:2e|2f|5c|00)/i.test(href))return null;
 const absolute=/^[a-z][a-z0-9+.-]*:/i.test(href)||href.startsWith('//');
 if(absolute&&!href.startsWith(`${TOWN_ORIGIN}/`))return null;
 const path=absolute?href.slice(TOWN_ORIGIN.length):href;
 if(/(^|\/)\.{1,2}(\/|$)/.test(path))return null;
 let u:URL;try{u=new URL(href,base);}catch{return null;}
 if(u.protocol!=='https:'||u.hostname!==TOWN_HOST||u.port||u.username||u.password||u.search||u.hash)return null;
 const m=DOC_PATH.exec(u.pathname);if(!m)return null;
 return {docId:Number(m[1]),url:`${TOWN_ORIGIN}${u.pathname}`};
}
// ---- robots.txt (RFC 9309 groups, longest match, allow wins ties). Unsupported applicable policy fails closed. ----
export type RobotsRule={allow:boolean;pattern:string};
export type RobotsPolicy={ok:true;rules:RobotsRule[];crawlDelayMs:number|null;group:'specific'|'wildcard'|'none'}|{ok:false;reason:'malformed'|'unsupported-field'|'unsupported-crawl-delay'|'unsupported-pattern'};
export function parseRobots(text:string):RobotsPolicy{
 type Group={agents:string[];rules:RobotsRule[];delays:string[];unknown:boolean};
 const groups:Group[]=[];let current:Group|null=null,lastWasAgent=false;
 for(const raw of text.split(/\r\n|\r|\n/)){
  const line=raw.replace(/#.*$/,'').trim();if(!line)continue;
  const i=line.indexOf(':');if(i<1)return {ok:false,reason:'malformed'};
  const key=line.slice(0,i).trim().toLowerCase(),value=line.slice(i+1).trim();
  if(key==='user-agent'){if(!current||!lastWasAgent){current={agents:[],rules:[],delays:[],unknown:false};groups.push(current);}current.agents.push(value.toLowerCase());lastWasAgent=true;continue;}
  lastWasAgent=false;
  if(key==='sitemap'||!current)continue;
  if(key==='allow'||key==='disallow'){if(value)current.rules.push({allow:key==='allow',pattern:value});continue;}
  if(key==='crawl-delay'){current.delays.push(value);continue;}
  current.unknown=true;
 }
 const token=ROBOTS_TOKEN.toLowerCase();
 const specific=groups.filter(g=>g.agents.some(a=>a.split('/')[0].trim()===token));
 const applicable=specific.length?specific:groups.filter(g=>g.agents.includes('*'));
 if(applicable.some(g=>g.unknown))return {ok:false,reason:'unsupported-field'};
 let delay:number|null=null;
 for(const d of applicable.flatMap(g=>g.delays)){if(!/^\d{1,6}(?:\.\d{1,3})?$/.test(d))return {ok:false,reason:'unsupported-crawl-delay'};delay=Math.max(delay??0,Number(d)*1000);}
 if(delay!==null&&delay>LIMITS.maxCrawlDelayMs)return {ok:false,reason:'unsupported-crawl-delay'};
 const rules=applicable.flatMap(g=>g.rules);
 if(rules.some(r=>r.pattern.length>500||!/^[/*]/.test(r.pattern)||(r.pattern.match(/\*/g)?.length??0)>10||/\$./.test(r.pattern)))return {ok:false,reason:'unsupported-pattern'};
 return {ok:true,rules,crawlDelayMs:delay,group:specific.length?'specific':applicable.length?'wildcard':'none'};
}
const upperEscapes=(s:string)=>s.replace(/%[0-9a-f]{2}/gi,m=>m.toUpperCase());
const escapeRe=(s:string)=>s.replace(/[.+?^${}()|[\]\\]/g,'\\$&');
// Paths are matched case-sensitively without any query; the collector never requests URLs with queries.
export function robotsAllows(policy:RobotsPolicy,path:string):boolean{
 if(!policy.ok)return false;
 const target=upperEscapes(path);let best:{len:number;allow:boolean}|null=null;
 for(const r of policy.rules){
  const anchored=r.pattern.endsWith('$'),body=upperEscapes(anchored?r.pattern.slice(0,-1):r.pattern);
  if(!new RegExp(`^${body.split('*').map(escapeRe).join('.*')}${anchored?'$':''}`).test(target))continue;
  if(!best||body.length>best.len||(body.length===best.len&&r.allow))best={len:body.length,allow:r.allow};
 }
 return best?best.allow:true;
}
// ---- Seed HTML: parse5 tree walk, no execution. Only a sanitized link inventory is persisted. ----
export const INVENTORY_REVISION='link-inventory-v2';
export interface LinkInventory {
 // truncated is true when any bound was reached; truncatedReasons names which. Omitted counts are distinct accepted
 // (document ID, URL) links and distinct numeric IDs beyond the link cap (duplicates are removed before the cap).
 revision:string;title:string|null;truncated:boolean;truncatedReasons?:('node-budget'|'document-link-cap')[];
 documents:{docId:number;url:string;text:string}[];
 // Brochure-like links that are not followed in this delivery (off-host flipbooks, other Town pages, unsafe URLs).
 // Off-host links keep the host only; Town links keep the path only. Queries (tokens/CSRF) are never retained.
 excluded:{reason:'off-host'|'town-non-document'|'unsafe-url';host:string|null;path:string|null;text:string}[];
 counts:{anchors:number;scripts:number;tokenBearing:number;registrationHost:number;excludedNotRecorded:number;documentLinksOmitted?:number;documentIdsOmitted?:number};
}
type InventoryState={seen:Set<string>;omittedIds:Set<number>};
const SKIP=new Set(['script','style','template','noscript','iframe','object','embed','svg','math']);
const REGISTRATION=/(^|\.)myvscloud\.com$/i;
const TOKENISH=/[?&;][^=&#]*(?:token|csrf|session|sid|auth|key|sig)[^=&#]*=/i;
const clip=(s:string,n:number)=>{const t=s.replace(/\s+/g,' ').trim();return t.length>n?t.slice(0,n):t;};
const attr=(node:any,name:string):string|null=>node.attrs?.find((a:any)=>a.name===name)?.value??null;
function textOf(node:any,limit=400){
 let out='';const stack=[node];
 while(stack.length&&out.length<limit){const n=stack.pop();if(n.nodeName==='#text'){out+=n.value;continue;}if(n.tagName&&SKIP.has(n.tagName))continue;const kids=n.childNodes??[];for(let i=kids.length-1;i>=0;i--)stack.push(kids[i]);}
 return out;
}
export function linkInventory(html:string,base:string):LinkInventory{
 const inv:LinkInventory={revision:INVENTORY_REVISION,title:null,truncated:false,truncatedReasons:[],documents:[],excluded:[],
  counts:{anchors:0,scripts:0,tokenBearing:0,registrationHost:0,excludedNotRecorded:0,documentLinksOmitted:0,documentIdsOmitted:0}};
 const state:InventoryState={seen:new Set(),omittedIds:new Set()};
 const stack:any[]=[parse(html)];let visited=0;
 while(stack.length){
  const node=stack.pop();
  if(++visited>200_000){inv.truncated=true;inv.truncatedReasons!.push('node-budget');break;}
  const tag:string|undefined=node.tagName;
  if(tag&&SKIP.has(tag)){if(tag==='script')inv.counts.scripts++;continue;}
  if(tag==='title'&&inv.title===null)inv.title=clip(textOf(node),200);
  if(tag==='a')anchor(inv,node,base,state);
  const kids=node.childNodes??[];for(let i=kids.length-1;i>=0;i--)stack.push(kids[i]);
 }
 inv.counts.documentIdsOmitted=state.omittedIds.size;
 if(inv.counts.documentLinksOmitted){inv.truncated=true;inv.truncatedReasons!.push('document-link-cap');}
 return inv;
}
function anchor(inv:LinkInventory,node:any,base:string,state:InventoryState){
 inv.counts.anchors++;const href=attr(node,'href');if(href===null)return;
 const text=clip(textOf(node),200);
 if(TOKENISH.test(href))inv.counts.tokenBearing++;
 const doc=documentLink(href,base);
 if(doc){
  // Duplicate anchors are removed before the cap; slug aliases of one numeric ID remain distinct links.
  const key=`${doc.docId} ${doc.url}`;if(state.seen.has(key))return;state.seen.add(key);
  if(inv.documents.length<LIMITS.inventoryDocumentLinks){inv.documents.push({...doc,text});return;}
  inv.counts.documentLinksOmitted!++;
  if(!inv.documents.some(d=>d.docId===doc.docId))state.omittedIds.add(doc.docId);
  return;
 }
 let u:URL|null=null;try{u=new URL(href.trim(),base);}catch{}
 const web=u&&(u.protocol==='https:'||u.protocol==='http:');
 if(web&&REGISTRATION.test(u!.hostname))inv.counts.registrationHost++;
 if(!/brochure|flip ?book|flippingbook/i.test(`${text} ${web?`${u!.hostname}${u!.pathname}`:''}`))return;
 if(inv.excluded.length>=100){inv.counts.excludedNotRecorded++;return;}
 inv.excluded.push(!web?{reason:'unsafe-url',host:null,path:null,text}:u!.hostname===TOWN_HOST?{reason:'town-non-document',host:TOWN_HOST,path:clip(u!.pathname,200),text}:{reason:'off-host',host:clip(u!.hostname.toLowerCase(),100),path:null,text});
}
// Conservative interstitial markers only; ordinary pages with embedded form widgets are not treated as challenges.
export const looksLikeChallenge=(html:string)=>/cdn-cgi\/challenge-platform|<title>\s*just a moment|attention required! \| cloudflare|_incapsula_resource/i.test(html);
