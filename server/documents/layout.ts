import {sha256} from './policy.ts';
import type {PdfPage,PdfItem,PdfResult} from './pdf.ts';
// Position-aware brochure segmentation. pdf.js content order interleaves columns, so blocks are built from geometry:
// program-code anchors define column start clusters; every kept item is assigned by its left edge to a column, and an
// item whose box reaches into the next column's start makes the whole page ambiguous (quarantined, never guessed).
// There is no page-midpoint split. Fields are raw source text with line/character spans; nothing is normalized into
// dates, years, recurrence, eligibility, capacity, sections or availability.
export const LAYOUT_REVISION='brochure-layout-v1';
export const PARSER_REVISION=`pdfjs-5.6.205+${LAYOUT_REVISION}`;
// The only program-specific pattern: 2–6 capital letters, an optional single space, 3–4 digits, at an item start.
// A code is a published label, not a unique identity.
export const CODE=/^([A-Z]{2,6} ?\d{3,4})(?![A-Za-z0-9])/;
const COLUMN_TOLERANCE=6,MIN_COLUMN_SPACING=120,MAX_COLUMNS=3,HEADING_RATIO=1.15,ANCHOR_RATIO=1.1,GAP_LINES=3.2;
export interface Line {text:string;x0:number;x1:number;y:number;h:number;anchor:boolean}
export interface Span {line:number;start:number;end:number}
export interface Field {text:string;spans:Span[]}
export interface DateLine extends Field {flags:string[]}
export interface ScheduleGroup {dayTime:Field|null;location:Field|null;dates:DateLine[]}
export interface Candidate {
 id:string;ordinal:number;page:number;column:number;bbox:[number,number,number,number];
 lines:{text:string;x0:number;y:number;x1:number;h:number}[];text:string;blockSha256:string;
 codeRaw:string;codeNormalized:string;code:Field;heading:Field|null;ages:Field|null;description:Field|null;
 scheduleGroups:ScheduleGroup[];instructor:Field|null;fee:Field|null;repeated:{label:string;field:Field}[];
 warnings:string[];duplicateCodeCount:number;
}
export interface Gaps {
 pagesTotal:number;pagesProcessed:number;textlessPages:number[];pagesWithoutCodes:number[];quarantinedPages:{page:number;reason:string}[];
 rotatedDropped:number;outOfPageDropped:number;outsideColumnItems:number;orphanLines:number;continuationLines:number;budget:null|'pages'|'chars'|'items';
}
export type ParseStatus='ok'|'partial'|'empty'|'failed';
export interface Analysis {parserRevision:string;status:ParseStatus;errorCategory:string|null;gaps:Gaps|null;candidates:Candidate[]}
type Block={page:number;column:number;lines:Line[];headingCount:number};
const r2=(n:number)=>Math.round(n*100)/100;
const median=(xs:number[])=>{const s=[...xs].sort((a,b)=>a-b);return s.length?s[Math.floor(s.length/2)]:0;};
function buildLines(items:PdfItem[]):Line[]{
 const sorted=[...items].sort((a,b)=>b.y-a.y||a.x-b.x);const groups:PdfItem[][]=[];
 for(const it of sorted){const g=groups.at(-1);if(g&&Math.abs(g[0].y-it.y)<=2)g.push(it);else groups.push([it]);}
 return groups.map(g=>{
  g.sort((a,b)=>a.x-b.x);let text='',end=-Infinity;
  for(const it of g){if(text&&it.x-end>Math.max(1,0.15*it.h)&&!/\s$/.test(text)&&!/^\s/.test(it.s))text+=' ';text+=it.s;end=Math.max(end,it.x+it.w);}
  return {text,x0:g[0].x,x1:end,y:g[0].y,h:Math.max(...g.map(i=>i.h)),anchor:(g[0] as any).anchor===true};
 });
}
function segmentPage(p:PdfPage,gaps:Gaps):Block[]{
 const kept:PdfItem[]=[];
 for(const it of p.items){
  if(!it.s.trim())continue;
  if(it.rot){gaps.rotatedDropped++;continue;}
  if(it.x< -1||it.y< -1||it.x+it.w>p.width+1||it.y>p.height+1){gaps.outOfPageDropped++;continue;}
  kept.push(it);
 }
 if(!kept.length){gaps.textlessPages.push(p.page);return [];}
 const bodyH=median(kept.map(i=>i.h).filter(h=>h>0));
 const anchors=kept.filter(i=>CODE.test(i.s)&&i.h<=bodyH*ANCHOR_RATIO);
 if(!anchors.length){gaps.pagesWithoutCodes.push(p.page);return [];}
 const xs=anchors.map(a=>a.x).sort((a,b)=>a-b),starts=[xs[0]];
 for(const x of xs)if(x-starts.at(-1)!>COLUMN_TOLERANCE)starts.push(x);
 const quarantine=(reason:string)=>{gaps.quarantinedPages.push({page:p.page,reason});return [];};
 if(starts.length>MAX_COLUMNS)return quarantine('unsupported-column-count');
 for(let k=1;k<starts.length;k++)if(starts[k]-starts[k-1]<MIN_COLUMN_SPACING)return quarantine('irregular-code-columns');
 const columns:PdfItem[][]=starts.map(()=>[]);
 for(const it of kept){
  let k=-1;for(let c=starts.length-1;c>=0;c--)if(it.x>=starts[c]-COLUMN_TOLERANCE){k=c;break;}
  if(k<0){gaps.outsideColumnItems++;continue;}
  // A wide left line reaching the next column start cannot be attributed safely.
  if(k<starts.length-1&&it.x+it.w>starts[k+1]-2)return quarantine('item-crosses-column-gutter');
  columns[k].push(anchors.includes(it)?Object.assign({},it,{anchor:true}):it);
 }
 // Body text starting far right of its column start, with no word-adjacent predecessor on the same baseline, is an
 // unanchored column (for example a text box beside a program column); merging it by baseline would mix columns.
 for(const [k,items] of columns.entries())for(const it of items){
  if(it.h>bodyH*ANCHOR_RATIO||it.x<starts[k]+MIN_COLUMN_SPACING)continue;
  if(!items.some(o=>o!==it&&Math.abs(o.y-it.y)<=2&&o.x<it.x&&o.x+o.w>=it.x-0.6*it.h&&o.x+o.w<=it.x+1))return quarantine('unanchored-text-column');
 }
 const blocks:Block[]=[],gapLimit=GAP_LINES*bodyH;
 columns.forEach((items,column)=>{
  let current:Block|null=null,pending:Line[]=[],lastY:number|null=null,seenBlock=false;
  const dropPending=()=>{gaps.orphanLines+=pending.length;pending=[];};
  for(const line of buildLines(items)){
   const gap=lastY===null?0:lastY-line.y;lastY=line.y;
   if(line.anchor){
    if(!pending.length||pending.at(-1)!.y-line.y>gapLimit)dropPending();
    current={page:p.page,column,lines:[...pending,line],headingCount:pending.length};pending=[];blocks.push(current);seenBlock=true;continue;
   }
   if(line.h>=bodyH*HEADING_RATIO){current=null;if(pending.length&&pending.at(-1)!.y-line.y>gapLimit)dropPending();pending.push(line);continue;}
   if(current&&gap<=gapLimit){current.lines.push(line);continue;}
   current=null;dropPending();
   if(seenBlock)gaps.orphanLines++;else gaps.continuationLines++;
  }
  dropPending();
 });
 return blocks;
}
const LABEL=/^(Day and Time|Location|Instructor|Fee)\s*:\s*/i,BULLET=/^[•▪●]\s*/;
const MONTHS=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
const RANGE=/^([A-Za-z]{3,5})\.?\s*(\d{1,2})\s*[-–]\s*([A-Za-z]{3,5})\.?\s*(\d{1,2})\b/;
// Conservative contradiction flags on the raw text only; the source text is never rewritten or given a year.
function dateFlags(text:string){
 const m=RANGE.exec(text);if(!m)return [];
 const a=MONTHS.indexOf(m[1].slice(0,3).toLowerCase()),b=MONTHS.indexOf(m[3].slice(0,3).toLowerCase());
 if(a<0||b<0)return [];
 if(a===b&&Number(m[4])<Number(m[2]))return ['end-before-start-same-month'];
 return b<a?['end-month-before-start-month']:[];
}
function trimmedSpan(line:number,text:string,start:number):Span|null{
 let s=start,e=text.length;while(s<e&&/\s/.test(text[s]))s++;while(e>s&&/\s/.test(text[e-1]))e--;
 return e>s?{line,start:s,end:e}:null;
}
const fieldFrom=(lines:Line[],span:Span|null):Field|null=>span?{text:lines[span.line].text.slice(span.start,span.end),spans:[span]}:null;
function extend(target:Field,lines:Line[],span:Span|null){if(span){target.text+=` ${lines[span.line].text.slice(span.start,span.end)}`;target.spans.push(span);}}
function fieldsOf(block:Block){
 const L=block.lines,a=block.headingCount,warnings:string[]=[];
 const headingSpans=L.slice(0,a).map((l,i)=>trimmedSpan(i,l.text,0)).filter((s):s is Span=>!!s);
 const heading=headingSpans.length?{text:headingSpans.map(s=>L[s.line].text.slice(s.start,s.end)).join(' '),spans:headingSpans}:null;
 if(!heading)warnings.push('missing:heading');
 const anchorText=L[a].text,codeRaw=CODE.exec(anchorText)![1];
 const code:Field={text:codeRaw,spans:[{line:a,start:0,end:codeRaw.length}]};
 let pos=codeRaw.length;while(pos<anchorText.length&&/\s/.test(anchorText[pos]))pos++;
 let ages:Field|null=null;
 if(anchorText[pos]==='('){const close=anchorText.indexOf(')',pos);if(close>pos&&close-pos<=40&&/^Ages?\b/i.test(anchorText.slice(pos+1))){ages={text:anchorText.slice(pos+1,close),spans:[{line:a,start:pos+1,end:close}]};pos=close+1;}}
 if(!ages)warnings.push('missing:ages');
 let description=fieldFrom(L,trimmedSpan(a,anchorText,pos));
 let target:Field|null=description,targetLabel='description';
 const groups:ScheduleGroup[]=[],repeated:{label:string;field:Field}[]=[];let group:ScheduleGroup|null=null,instructor:Field|null=null,fee:Field|null=null;
 const continued=new Set<string>();
 for(let i=a+1;i<L.length;i++){
  const t=L[i].text,lm=LABEL.exec(t);
  if(lm){
   const label=lm[1].toLowerCase(),f=fieldFrom(L,trimmedSpan(i,t,lm[0].length))??{text:'',spans:[]};
   if(label==='day and time'){group={dayTime:f,location:null,dates:[]};groups.push(group);}
   else if(label==='location'){if(!group||group.location){group={dayTime:null,location:f,dates:[]};groups.push(group);}else group.location=f;}
   else if(label==='instructor'){if(instructor)repeated.push({label,field:f});else instructor=f;}
   else{if(fee)repeated.push({label,field:f});else fee=f;}
   target=f;targetLabel=label;continue;
  }
  const bm=BULLET.exec(t);
  if(bm){
   if(!group){group={dayTime:null,location:null,dates:[]};groups.push(group);}
   const span=trimmedSpan(i,t,bm[0].length),d:DateLine={...(fieldFrom(L,span)??{text:'',spans:[]}),flags:[]};
   group.dates.push(d);target=d;targetLabel='date';continue;
  }
  // Unlabelled lines continue the preceding field; the join is reported so consumers can check the raw lines.
  if(!target){description=fieldFrom(L,trimmedSpan(i,t,0));target=description;continue;}
  extend(target,L,trimmedSpan(i,t,0));if(targetLabel!=='description')continued.add(targetLabel);
 }
 groups.forEach(g=>g.dates.forEach(d=>{d.flags=dateFlags(d.text);}));
 for(const label of continued)warnings.push(`multi-line-field:${label}`);
 if(!groups.length)warnings.push('missing:day-and-time');
 groups.forEach((g,i)=>{
  if(!g.dayTime)warnings.push(`missing:day-and-time:group-${i+1}`);
  if(!g.location)warnings.push(`missing:location:group-${i+1}`);
  if(!g.dates.length)warnings.push(`missing:dates:group-${i+1}`);
  g.dates.forEach(d=>d.flags.forEach(f=>warnings.push(`date-${f}:group-${i+1}`)));
 });
 if(!instructor)warnings.push('missing:instructor');
 if(!fee)warnings.push('missing:fee');
 for(const r of repeated)warnings.push(`repeated-field:${r.label}`);
 return {codeRaw,code,heading,ages,description,scheduleGroups:groups,instructor,fee,repeated,warnings};
}
// Whole-document analysis. Candidate identities are versioned fragments: source key + full document hash + parser
// revision + page + column + document ordinal (identical bytes under two document IDs stay distinct). Identical codes are
// never merged; each repeat is flagged.
export function analyzeDocument(pdf:PdfResult,source:{key:string;documentSha256:string},parserRevision=PARSER_REVISION):Analysis{
 const documentSha256=`${source.key}\n${source.documentSha256}`;
 if(!pdf.ok)return {parserRevision,status:'failed',errorCategory:pdf.category,gaps:null,candidates:[]};
 const gaps:Gaps={pagesTotal:pdf.numPages,pagesProcessed:pdf.pages.length,textlessPages:[],pagesWithoutCodes:[],quarantinedPages:[],rotatedDropped:0,outOfPageDropped:0,outsideColumnItems:0,orphanLines:0,continuationLines:0,budget:pdf.truncated};
 const blocks=pdf.pages.flatMap(p=>segmentPage(p,gaps));
 const candidates:Candidate[]=blocks.map((b,ordinal)=>{
  const f=fieldsOf(b),text=b.lines.map(l=>l.text).join('\n');
  return {id:`dc_${sha256(`${documentSha256}\n${parserRevision}\n${b.page}\n${b.column}\n${ordinal}`).slice(0,32)}`,ordinal,page:b.page,column:b.column,
   bbox:[r2(Math.min(...b.lines.map(l=>l.x0))),r2(Math.min(...b.lines.map(l=>l.y))),r2(Math.max(...b.lines.map(l=>l.x1))),r2(Math.max(...b.lines.map(l=>l.y+l.h)))],
   lines:b.lines.map(l=>({text:l.text,x0:r2(l.x0),y:r2(l.y),x1:r2(l.x1),h:r2(l.h)})),text,blockSha256:sha256(text),
   codeNormalized:f.codeRaw.replace(' ',''),duplicateCodeCount:1,...f};
 });
 const counts=new Map<string,number>();for(const c of candidates)counts.set(c.codeNormalized,(counts.get(c.codeNormalized)??0)+1);
 for(const c of candidates){c.duplicateCodeCount=counts.get(c.codeNormalized)!;if(c.duplicateCodeCount>1)c.warnings.push('duplicate-code-in-document');}
 const status:ParseStatus=gaps.budget||gaps.quarantinedPages.length?'partial':candidates.length?'ok':'empty';
 return {parserRevision,status,errorCategory:null,gaps,candidates};
}
