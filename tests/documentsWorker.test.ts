import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {extractPdf} from '../server/documents/pdf.ts';
import {analyzeDocument} from '../server/documents/layout.ts';
import {LIMITS,sha256} from '../server/documents/policy.ts';
import {makePdf} from './helpers/documents.ts';
// Real disposable pdf.js worker on SYNTHETIC PDFs; hostile synthetic workers prove wall-clock, heap and crash handling.
const HOSTILE=new URL('./fixtures/documents/hostile-worker.mjs',import.meta.url);
const runs=[
 {text:'TINY SYNTHETIC CLASS',x:110,y:740,size:14},{text:'FIT0901 (Ages 2-5) Invented class text.',x:82,y:718},
 {text:'Day and Time: Mondays, 9:30-10:15AM',x:82,y:692},{text:'Location: North Hall',x:82,y:679},{text:'Fee: Resident $1',x:82,y:666},
 {text:'SIDEBAR',x:20,y:400,size:22,rotated:true},
];
test('real worker extracts positioned items from a synthetic PDF, flags rotation, and leaves the retained bytes intact',async()=>{
 const bytes=makePdf([runs,[]]),before=sha256(bytes);
 const r=await extractPdf(bytes);
 assert.equal(r.ok,true);if(!r.ok)return;
 assert.equal(r.numPages,2);assert.equal(r.truncated,null);
 const code=r.pages[0].items.find(i=>i.s.startsWith('FIT0901'))!;
 assert.ok(Math.abs(code.x-82)<0.5&&Math.abs(code.y-718)<0.5&&code.h>0&&code.w>0);
 assert.equal(r.pages[0].items.find(i=>i.s==='SIDEBAR')!.rot,true);
 // The transferred copy never detaches or alters the caller's buffer.
 assert.equal(bytes.byteLength>0,true);assert.equal(sha256(bytes),before);
 const a=analyzeDocument(r,{key:'doc:9',documentSha256:before});
 assert.deepEqual(a.candidates.map(c=>[c.codeRaw,c.ages?.text,c.heading?.text,c.scheduleGroups[0]?.location?.text,c.fee?.text]),[['FIT0901','Ages 2-5','TINY SYNTHETIC CLASS','North Hall','Resident $1']]);
 assert.deepEqual(a.gaps!.textlessPages,[2]);assert.equal(a.gaps!.rotatedDropped,1);
});
test('page and character budgets truncate explicitly; malformed and oversize inputs fail with fixed categories',async()=>{
 const three=makePdf([runs,runs,runs]);
 const pages=await extractPdf(three,{limits:{pages:2,chars:LIMITS.chars,items:LIMITS.items}});
 assert.equal(pages.ok&&pages.truncated,'pages');assert.equal(pages.ok&&pages.pages.length,2);assert.equal(pages.ok&&pages.numPages,3);
 const chars=await extractPdf(three,{limits:{pages:80,chars:40,items:LIMITS.items}});
 assert.equal(chars.ok&&chars.truncated,'chars');
 assert.deepEqual(await extractPdf(Buffer.from('%PDF-1.4\nnot really a pdf\n')),{ok:false,category:'malformed'});
 assert.deepEqual(await extractPdf(new Uint8Array(LIMITS.pdfBytes+1)),{ok:false,category:'too-large'});
});
test('wall-clock timeout terminates a spinning worker; heap limit and crashes become fixed categories without text',async()=>{
 const started=Date.now();
 assert.deepEqual(await extractPdf(Buffer.from('s'),{workerUrl:HOSTILE,timeoutMs:300}),{ok:false,category:'timeout'});
 assert.ok(Date.now()-started<10_000);
 assert.deepEqual(await extractPdf(Buffer.from('m'),{workerUrl:HOSTILE,heapMb:32,timeoutMs:30_000}),{ok:false,category:'resource-limit'});
 const crash=await extractPdf(Buffer.from('t'),{workerUrl:HOSTILE,timeoutMs:10_000});
 assert.deepEqual(crash,{ok:false,category:'crash'});assert.equal(JSON.stringify(crash).includes('SENTINEL'),false);
});
// Retained public evidence (ignored data/author-evidence); skipped, not faked, when absent.
const SEASON=new URL('../data/author-evidence/season.pdf',import.meta.url);
test('retained public brochure preflight through the real worker',{skip:existsSync(SEASON)?false:'retained public brochure not present'},async()=>{
 const bytes=readFileSync(SEASON);
 assert.equal(sha256(bytes),'9241434226b0293de150d0b11a3fb20796984b7cc8087791ec81649ff0966e5a');
 const r=await extractPdf(bytes);
 assert.equal(r.ok,true);if(!r.ok)return;
 assert.equal(r.numPages,52);assert.equal(r.truncated,null);
 const a=analyzeDocument(r,{key:'doc:16912',documentSha256:sha256(bytes)});
 assert.ok(a.gaps!.textlessPages.includes(52));
 assert.deepEqual(a.candidates.filter(c=>c.page===6).map(c=>c.codeRaw).sort(),['ARTC0003','ARTC0004','ARTC0005','ARTC0006','FIT0041','FIT0042']);
 const fit=a.candidates.find(c=>c.codeRaw==='FIT0041')!;
 assert.equal(fit.scheduleGroups[0].location!.text,'South Park Community Center');assert.equal(fit.instructor!.text,'Maggie Witter');
 assert.ok(a.candidates.some(c=>c.codeRaw==='CAMPS 0041'));
 const camps38=a.candidates.find(c=>c.codeRaw==='CAMPS0038');
 if(camps38)assert.ok(camps38.scheduleGroups.some(g=>g.dates.some(d=>d.text==='Oct. 29- Oct. 23'&&d.flags.includes('end-before-start-same-month'))));
});
