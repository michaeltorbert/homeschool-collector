import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {analyzeDocument,PARSER_REVISION,type Candidate} from '../server/documents/layout.ts';
import {block,it,page,pdf,twoColumnPage} from './helpers/documents.ts';
// SYNTHETIC positional layouts (invented programs). One optional check reads the ignored, locally retained public
// brochure token export when present; it is skipped, not faked, when absent.
const SRC={key:'doc:1',documentSha256:'a'.repeat(64)};
const by=(cs:Candidate[],code:string)=>cs.filter(c=>c.codeRaw===code);
const one=(cs:Candidate[],code:string)=>{const m=by(cs,code);assert.equal(m.length,1,code);return m[0];};
test('interleaved two-column stream: each code keeps its own heading, ages, schedule, location, instructor and fee',()=>{
 const a=analyzeDocument(pdf([twoColumnPage(6)]),SRC);
 assert.equal(a.status,'ok');assert.equal(a.parserRevision,PARSER_REVISION);
 assert.deepEqual(a.candidates.map(c=>[c.codeRaw,c.column]),[['FIT0941',0],['ARTC0903',0],['FIT0942',1],['ARTC0905',1]]);
 const fit=one(a.candidates,'FIT0941');
 assert.equal(fit.heading!.text,'TINY TUMBLE TIME');assert.equal(fit.ages!.text,'Ages 2-3');
 assert.equal(fit.description!.text,'Synthetic tumbling for toddlers and a grown-up.');
 assert.deepEqual(fit.scheduleGroups.map(g=>[g.dayTime?.text,g.location?.text,g.dates.map(d=>d.text)]),[['Wednesdays, 12:00-12:45PM','North Park Center',['Sept. 16- Sept. 30','Oct. 14- Oct. 28']]]);
 assert.equal(fit.instructor!.text,'Alex Rivera');assert.equal(fit.fee!.text,'Resident $48 / Non-Resident $72');assert.deepEqual(fit.warnings,[]);
 const right=one(a.candidates,'FIT0942');
 assert.equal(right.heading!.text,'LITTLE MOVERS STRETCH AND PLAY');
 assert.equal(right.scheduleGroups[0].location!.text,'Hilltop Town Park Community Center');assert.ok(right.warnings.includes('multi-line-field:location'));
 assert.equal(right.fee!.text,'Resident $40 / Non-Resident $60');assert.equal(right.instructor!.text,'Sam Lee');
 // The heading emitted far from its code in content order still binds by position.
 assert.equal(one(a.candidates,'ARTC0903').heading!.text,'MESSY ART STUDIO');assert.equal(one(a.candidates,'ARTC0905').heading!.text,'SENSORY STORYTIME');
 assert.equal(one(a.candidates,'ARTC0903').fee!.text,'Resident $16 / Non-Resident $24');
 // Spans resolve to the raw line text; bbox/page/column/hash evidence is present.
 for(const c of a.candidates){
  for(const f of [c.code,c.heading!,c.fee!])for(const s of f.spans)assert.ok(c.lines[s.line].text.slice(s.start,s.end).length>0);
  assert.equal(c.lines[c.code.spans[0].line].text.slice(0,c.codeRaw.length),c.codeRaw);
  assert.equal(c.page,6);assert.match(c.blockSha256,/^[a-f0-9]{64}$/);assert.match(c.id,/^dc_[a-f0-9]{32}$/);assert.equal(c.bbox.length,4);
 }
 assert.equal(a.gaps!.rotatedDropped,1);assert.ok(a.gaps!.outsideColumnItems>=1);
});
test('narrow gutter mirrored layout, raw code spacing, multiple schedule groups, backward dates and missing fields',()=>{
 const left=block({x:18.6,top:740,heading:['CHESS CLUB'],code:'SOCL 0904',ages:'Ages 4-18',desc:['Synthetic open play.'],
  groups:[{dayTime:'Mondays, 11:00AM-12:00PM',location:['South Hall'],locationFirst:true,dates:['Sept. 7- Dec. 21']},{dayTime:'Thursdays, 11:00AM-12:00PM',location:['Hilltop Town Park Community','Center'],locationFirst:true,dates:['Sept. 10- Dec. 17 (No class Nov. 26)']}],
  fee:'Free, participants must register in advance.'});
 const right=block({x:279.16,top:740,heading:['FALL BREAK CAMP'],code:'CAMPS0938',ages:'Ages 5-12',desc:['Synthetic camp week.'],groups:[{dayTime:'Monday-Friday, 7:30AM-6:00PM',dates:['Oct. 29- Oct. 23'],location:['North Park Center']}],instructor:'Staff',fee:'Resident $150 / Non-Resident $225'});
 const a=analyzeDocument(pdf([page(9,[...right,...left,it('WIDE SIDEBAR',591.6,517,22)])]),SRC);
 assert.equal(a.status,'ok');
 const socl=one(a.candidates,'SOCL 0904');assert.equal(socl.codeNormalized,'SOCL0904');assert.equal(socl.column,0);
 assert.deepEqual(socl.scheduleGroups.map(g=>[g.dayTime?.text,g.location?.text,g.dates.map(d=>d.text)]),[
  ['Mondays, 11:00AM-12:00PM','South Hall',['Sept. 7- Dec. 21']],
  ['Thursdays, 11:00AM-12:00PM','Hilltop Town Park Community Center',['Sept. 10- Dec. 17 (No class Nov. 26)']]]);
 assert.equal(socl.instructor,null);assert.ok(socl.warnings.includes('missing:instructor'));assert.equal(socl.fee!.text,'Free, participants must register in advance.');
 const camp=one(a.candidates,'CAMPS0938');
 // The source's backward range stays raw, flagged, with no year, ISO date or reordering.
 assert.equal(camp.scheduleGroups[0].dates[0].text,'Oct. 29- Oct. 23');assert.deepEqual(camp.scheduleGroups[0].dates[0].flags,['end-before-start-same-month']);
 assert.ok(camp.warnings.includes('date-end-before-start-same-month:group-1'));
 assert.equal(JSON.stringify(a.candidates).includes('2026-'),false);
 assert.equal(a.gaps!.outOfPageDropped,1);
});
test('duplicate raw codes stay separate candidates with distinct identities and flags; ids bind source and parser revision',()=>{
 const left=block({x:82,top:740,heading:['SESSION ONE'],code:'ARTC0901',ages:'Ages 6-9',groups:[{dayTime:'Mondays',dates:['Sept. 7'],location:['Hall']}],instructor:'A',fee:'$1'});
 const left2=block({x:82,top:520,heading:['SESSION TWO'],code:'ARTC0901',ages:'Ages 6-9',groups:[{dayTime:'Tuesdays',dates:['Sept. 8'],location:['Hall']}],instructor:'A',fee:'$1'});
 const doc=pdf([page(3,[...left,...left2])]);
 const a=analyzeDocument(doc,SRC),b=analyzeDocument(doc,{...SRC,key:'doc:2'}),c=analyzeDocument(doc,SRC,'other-rev');
 assert.equal(a.candidates.length,2);assert.notEqual(a.candidates[0].id,a.candidates[1].id);
 assert.ok(a.candidates.every(x=>x.duplicateCodeCount===2&&x.warnings.includes('duplicate-code-in-document')));
 assert.deepEqual(a.candidates.map(x=>x.scheduleGroups[0].dayTime!.text),['Mondays','Tuesdays']);
 assert.deepEqual(analyzeDocument(doc,SRC).candidates.map(x=>x.id),a.candidates.map(x=>x.id));
 assert.notEqual(b.candidates[0].id,a.candidates[0].id);assert.notEqual(c.candidates[0].id,a.candidates[0].id);
});
test('ambiguous layouts quarantine the page while safe pages still yield candidates; gaps are counted, not hidden',()=>{
 const wide=[...block({x:82,top:740,code:'FIT0901',heading:['A'],groups:[{dayTime:'Mondays'}]}),...block({x:348,top:740,code:'FIT0902',heading:['B'],groups:[{dayTime:'Tuesdays'}]}),
  it('A wide left line that runs straight across the column gutter into the right column',82,600)];
 const unanchored=[...block({x:82,top:740,code:'FIT0903',heading:['C'],groups:[{dayTime:'Mondays'}]}),it('Body text in an unanchored right column',348,700),it('more right text',348,686.8)];
 const tooMany=[...[20,160,300,440].map((x,i)=>block({x,top:740,code:`EDU090${i}`,heading:['H']})).flat()];
 const continuation=[it('continued from a previous page',82,760),...block({x:82,top:700,code:'FIT0904',heading:['D'],groups:[{dayTime:'Mondays'}]})];
 const a=analyzeDocument(pdf([twoColumnPage(1),page(2,wide),page(3,unanchored),page(4,tooMany),page(5,[]),page(6,[it('ROTATED',20,500,11,true)]),page(7,continuation),page(8,[it('Intro text only',82,700)])]),SRC);
 assert.equal(a.status,'partial');
 assert.deepEqual(a.gaps!.quarantinedPages,[{page:2,reason:'item-crosses-column-gutter'},{page:3,reason:'unanchored-text-column'},{page:4,reason:'unsupported-column-count'}]);
 assert.deepEqual(a.gaps!.textlessPages,[5,6]);assert.deepEqual(a.gaps!.pagesWithoutCodes,[8]);assert.equal(a.gaps!.continuationLines,1);
 assert.ok(a.gaps!.rotatedDropped>=2);
 assert.deepEqual(a.candidates.map(c=>c.codeRaw),['FIT0941','ARTC0903','FIT0942','ARTC0905','FIT0904']);
 assert.ok(a.candidates.every(c=>c.page!==2&&c.page!==3&&c.page!==4));
});
test('budget truncation is partial, an empty traversal is empty, and a worker failure is failed with no candidates',()=>{
 assert.equal(analyzeDocument(pdf([twoColumnPage(1)],90,'pages'),SRC).status,'partial');
 assert.equal(analyzeDocument(pdf([twoColumnPage(1)],1,'chars'),SRC).gaps!.budget,'chars');
 assert.equal(analyzeDocument(pdf([page(1,[it('Cover',100,700)]),page(2,[])]),SRC).status,'empty');
 assert.deepEqual(analyzeDocument({ok:false,category:'timeout'},SRC),{parserRevision:PARSER_REVISION,status:'failed',errorCategory:'timeout',gaps:null,candidates:[]});
});
// Retained public evidence (ignored data/author-evidence): pdf.js positional tokens of the Sept–Dec 2026 brochure.
const TOKENS=new URL('../data/author-evidence/season-node-items.json',import.meta.url);
test('retained public tokens: page 6 and page 9 blocks keep their own fields',{skip:existsSync(TOKENS)?false:'retained public token export not present'},()=>{
 const raw=JSON.parse(readFileSync(TOKENS,'utf8')) as any[];
 const pages=raw.filter(p=>p.page===6||p.page===9).map(p=>page(p.page,p.items.map((i:any)=>({s:i.text,x:i.x,y:i.y,w:i.width,h:i.height,rot:false}))));
 const a=analyzeDocument(pdf(pages,52),{key:'doc:16912',documentSha256:'0'.repeat(64)});
 const f=(code:string)=>{const c=one(a.candidates,code);return {page:c.page,ages:c.ages?.text,groups:c.scheduleGroups.map(g=>[g.dayTime?.text??null,g.location?.text??null,g.dates.map(d=>d.text)]),instructor:c.instructor?.text??null,fee:c.fee?.text??null,heading:c.heading?.text??null};};
 assert.deepEqual(a.candidates.filter(c=>c.page===6).map(c=>c.codeRaw).sort(),['ARTC0003','ARTC0004','ARTC0005','ARTC0006','FIT0041','FIT0042']);
 assert.deepEqual(f('FIT0041'),{page:6,ages:'Ages 2-3',heading:'TINY TOT GYMNASTICS',instructor:'Maggie Witter',fee:'Resident $48 / Non-Resident $72',
  groups:[['Wednesdays, 12:00-12:45PM','South Park Community Center',['Sept. 16- Sept. 30','Oct. 14- Oct. 28','Nov. 4- Nov. 25 (No class Nov. 11)','Dec. 2- Dec. 16']]]});
 assert.deepEqual(f('FIT0042'),{page:6,ages:'Ages 2-5',heading:'LITTLE WONDERS STRETCH AND PLAY',instructor:'Ashley Park',fee:'Resident $48 / Non-Resident $72',
  groups:[['Tuesdays, 9:30-10:15AM','Hilltop Needmore Town Park Community Center',['Sept. 8- Sept. 22','Oct. 6- Oct. 20','Nov. 3- Nov. 17']]]});
 assert.deepEqual(f('ARTC0003'),{page:6,ages:'Ages 2-5',heading:'LITTLE WONDERS ART STUDIO',instructor:'Ashley Park',fee:'Resident $48 / Non-Resident $72',
  groups:[['Mondays, 9:30-10:15AM','South Park Community Center',['Sept. 7- Sept. 21','Oct. 5- Oct. 19','Nov. 2- Nov. 16']]]});
 assert.deepEqual(f('ARTC0004'),{page:6,ages:'Ages 2-5',heading:'LITTLE WONDERS SENSORY PLAY',instructor:'Ashley Park',fee:'Resident $48 / Non-Resident $72',
  groups:[['Mondays, 10:45-11:30AM','South Park Community Center',['Sept. 7- Sept. 21','Oct. 5- Oct. 19','Nov. 2- Nov. 16']]]});
 assert.deepEqual(f('ARTC0005'),{page:6,ages:'Ages 2-5',heading:'LITTLE WONDERS CRAFTY STORYTIME',instructor:'Ashley Park',fee:'Resident $48 / Non-Resident $72',
  groups:[['Tuesdays, 10:45-11:30AM','Hilltop Needmore Town Park Community Center',['Sept. 8- Sept. 22','Oct. 6- Oct. 20','Nov. 3- Nov. 17']]]});
 assert.deepEqual(f('ARTC0006'),{page:6,ages:'Ages 3-5',heading:'GIVING THANKS: A SENSORY STORYTIME',instructor:'Ashley Park',fee:'Resident $16 / Non-Resident $24',
  groups:[['Thursday, 9:30-10:15AM','Hilltop Needmore Town Park Community Center',['Nov. 19']]]});
 const camps=one(a.candidates,'CAMPS 0041');assert.equal(camps.codeNormalized,'CAMPS0041');assert.equal(camps.ages!.text,'Ages 7-12');
 assert.deepEqual(f('SOCL0004').groups,[['Mondays, 11:00AM-12:00PM','South Park Community Center',['Sept. 7- Dec. 21']],['Thursdays, 11:00AM-12:00PM','Hilltop Needmore Town Park Community Center',['Sept. 10- Dec. 17 (No class Nov. 26)']]]);
 assert.equal(f('SOCL0004').instructor,null);
 assert.deepEqual(a.candidates.filter(c=>c.page===9).map(c=>c.codeNormalized).sort(),['CAMPS0041','CAMPS0042','CAMPS0043','FIT0044','FIT0046','SOCL0004']);
 assert.deepEqual(a.gaps!.quarantinedPages,[]);
});
