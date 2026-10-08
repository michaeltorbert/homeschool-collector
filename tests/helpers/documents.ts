import type {PdfItem,PdfPage,PdfResult} from '../../server/documents/pdf.ts';
// SYNTHETIC positioned-text builders. Geometry mirrors the measured brochure layout (13.2 pt line pitch, 11 pt body,
// 14 pt headings, bullet text indented 18 pt, blank line before schedules); all program text is invented.
export const width=(s:string,h:number)=>s.length*h*0.47;
export const it=(s:string,x:number,y:number,h=11,rot=false):PdfItem=>({s,x,y,w:width(s,h),h,rot});
export interface Group {dayTime?:string;location?:string[];dates?:string[];locationFirst?:boolean}
export interface Spec {x:number;top:number;heading?:string[];code:string;ages?:string;desc?:string[];groups?:Group[];instructor?:string;fee?:string}
export function block(s:Spec):PdfItem[]{
 const out:PdfItem[]=[];let y=s.top,first=true;
 const line=(text:string,gap:number,x=s.x,h=11)=>{if(!first)y-=gap;first=false;out.push(it(text,x,y,h));};
 for(const h of s.heading??[])line(h,17,s.x+20,14);
 if(!first)y-=21.5;first=false;
 const code=it(s.code,s.x,y);out.push(code,it(' ',code.x+code.w,y,0));
 const rest=[s.ages?`(${s.ages})`:'',s.desc?.[0]??''].filter(Boolean).join(' ');
 if(rest)out.push(it(rest,code.x+code.w+3.06,y));
 for(const d of (s.desc??[]).slice(1))line(d,13.2);
 for(const g of s.groups??[]){
  let gap=26.4;const put=(t:string)=>{line(t,gap);gap=13.2;};
  if(g.dayTime!==undefined)put(`Day and Time: ${g.dayTime}`);
  const locations=()=>(g.location??[]).forEach((l,i)=>put(i?l:`Location: ${l}`));
  if(g.locationFirst)locations();
  for(const d of g.dates??[]){y-=gap;gap=13.2;out.push(it('•',s.x,y),it(' ',s.x+3.85,y,0),it(d,s.x+18,y));}
  if(!g.locationFirst)locations();
 }
 if(s.instructor)line(`Instructor: ${s.instructor}`,13.2);
 if(s.fee)line(`Fee: ${s.fee}`,13.2);
 return out;
}
export const page=(n:number,items:PdfItem[],w=612,h=792):PdfPage=>({page:n,width:w,height:h,items});
export function pdf(pages:PdfPage[],numPages=pages.length,truncated:null|'pages'|'chars'|'items'=null):PdfResult{
 return {ok:true,numPages,pages,truncated,chars:pages.reduce((n,p)=>n+p.items.reduce((m,i)=>m+i.s.length,0),0),items:pages.reduce((n,p)=>n+p.items.length,0)};
}
// Minimal valid synthetic PDF (Helvetica text runs placed with Tm; a rotated run uses a rotation matrix).
export type Run={text:string;x:number;y:number;size?:number;rotated?:boolean};
export function makePdf(pages:Run[][]):Buffer{
 const esc=(s:string)=>s.replace(/[\\()]/g,m=>`\\${m}`);
 const objects:string[]=[];const font=3+pages.length*2;
 objects[1]='<< /Type /Catalog /Pages 2 0 R >>';
 objects[2]=`<< /Type /Pages /Kids [${pages.map((_,i)=>`${3+i*2} 0 R`).join(' ')}] /Count ${pages.length} >>`;
 pages.forEach((runs,i)=>{
  const content=runs.map(r=>`BT /F1 ${r.size??11} Tf ${r.rotated?'0 1 -1 0':'1 0 0 1'} ${r.x} ${r.y} Tm (${esc(r.text)}) Tj ET`).join('\n');
  objects[3+i*2]=`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${4+i*2} 0 R /Resources << /Font << /F1 ${font} 0 R >> >> >>`;
  objects[4+i*2]=`<< /Length ${Buffer.byteLength(content,'latin1')} >>\nstream\n${content}\nendstream`;
 });
 objects[font]='<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
 let out='%PDF-1.4\n';const offsets:number[]=[];
 for(let n=1;n<objects.length;n++){offsets[n]=Buffer.byteLength(out,'latin1');out+=`${n} 0 obj\n${objects[n]}\nendobj\n`;}
 const xref=Buffer.byteLength(out,'latin1');
 out+=`xref\n0 ${objects.length}\n0000000000 65535 f \n${offsets.slice(1).map(o=>`${String(o).padStart(10,'0')} 00000 n \n`).join('')}`;
 out+=`trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
 return Buffer.from(out,'latin1');
}
// A two-column page whose content-stream order interleaves the columns, like the measured brochure pages.
export function twoColumnPage(n:number){
 const a=block({x:82,top:758,heading:['TINY TUMBLE TIME'],code:'FIT0941',ages:'Ages 2-3',desc:['Synthetic tumbling for','toddlers and a grown-up.'],
  groups:[{dayTime:'Wednesdays, 12:00-12:45PM',dates:['Sept. 16- Sept. 30','Oct. 14- Oct. 28'],location:['North Park Center']}],instructor:'Alex Rivera',fee:'Resident $48 / Non-Resident $72'});
 const b=block({x:348.04,top:760,heading:['LITTLE MOVERS STRETCH AND','PLAY'],code:'FIT0942',ages:'Ages 2-5',desc:['Synthetic stretching games.'],
  groups:[{dayTime:'Tuesdays, 9:30-10:15AM',dates:['Sept. 8- Sept. 22'],location:['Hilltop Town Park Community','Center']}],instructor:'Sam Lee',fee:'Resident $40 / Non-Resident $60'});
 const c=block({x:83.08,top:560,heading:['MESSY ART STUDIO'],code:'ARTC0903',ages:'Ages 2-5',desc:['Synthetic painting session.'],
  groups:[{dayTime:'Mondays, 9:30-10:15AM',dates:['Nov. 2- Nov. 16'],location:['North Park Center']}],instructor:'Sam Lee',fee:'Resident $16 / Non-Resident $24'});
 const d=block({x:349.04,top:560,heading:['SENSORY','STORYTIME'],code:'ARTC0905',ages:'Ages 3-5',desc:['Synthetic story and play.'],
  groups:[{dayTime:'Thursday, 9:30-10:15AM',dates:['Nov. 19'],location:['Hilltop Town Park Community','Center']}],instructor:'Sam Lee',fee:'Resident $12 / Non-Resident $18'});
 // Stream order: a, b, c's heading, d, then c's body — the heading of c is separated from its code in content order.
 return page(n,[it(String(n),25.9,28,22),it('YOUTH',20,774.6,22,true),...a,...b,...c.slice(0,1),...d,...c.slice(1)]);
}
