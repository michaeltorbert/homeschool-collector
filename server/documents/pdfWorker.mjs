// Disposable data-only pdf.js text extraction. Runs in a worker thread with an explicit JS heap limit; the parent
// terminates it on timeout. No eval, worker fetch, font faces, system fonts or remote font/CMap URLs; input is the
// transferred byte copy only. Errors are reduced to fixed categories; no exception text leaves the worker.
import {parentPort,workerData} from 'node:worker_threads';
const {data,limits}=workerData;
let doc=null;
try{
 const pdfjs=await import('pdfjs-dist/legacy/build/pdf.mjs');
 doc=await pdfjs.getDocument({data,isEvalSupported:false,useWorkerFetch:false,disableFontFace:true,useSystemFonts:false,disableAutoFetch:true,disableStream:true,disableRange:true,enableXfa:false,isOffscreenCanvasSupported:false,isImageDecoderSupported:false,verbosity:0}).promise;
 const pages=[];let chars=0,items=0,truncated=null;
 const last=Math.min(doc.numPages,limits.pages);if(doc.numPages>limits.pages)truncated='pages';
 outer:for(let p=1;p<=last;p++){
  const page=await doc.getPage(p);const [x0,y0,x1,y1]=page.view;
  const content=await page.getTextContent({includeMarkedContent:false});
  const out=[];
  for(const it of content.items){
   if(typeof it.str!=='string')continue;
   items++;chars+=it.str.length;
   if(items>limits.items){truncated='items';break outer;}
   if(chars>limits.chars){truncated='chars';break outer;}
   const t=it.transform;
   // Any skew/rotation or mirrored text is flagged; the parent drops and counts it rather than guessing reading order.
   out.push({s:it.str,x:t[4]-x0,y:t[5]-y0,w:it.width,h:it.height,rot:Math.abs(t[1])>1e-6||Math.abs(t[2])>1e-6||t[0]<0||t[3]<0});
  }
  pages.push({page:p,width:x1-x0,height:y1-y0,items:out});
  page.cleanup();
 }
 parentPort.postMessage({ok:true,numPages:doc.numPages,pages,truncated,chars,items});
}catch(e){
 parentPort.postMessage({ok:false,category:e?.name==='PasswordException'?'encrypted':'malformed'});
}finally{
 await doc?.destroy().catch(()=>{});
}
