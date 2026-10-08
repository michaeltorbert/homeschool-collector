import type {IncomingMessage,ServerResponse} from 'node:http';
import {ConflictError,ScanBusyError,type Store} from './store.ts';
import {ProfileError} from '../src/age.ts';
export function send(res:ServerResponse,status:number,data:any){res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));}
async function body(req:IncomingMessage){let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>32_000)throw Error('Request too large.');}return JSON.parse(raw||'{}');}
// Loopback host/peer, same-origin and JSON-mutation guards apply to every /api/ route, including the private profile routes.
export function createHandler(options:{store:Store;port:()=>number;scan:()=>Promise<any>;scanState:()=>{scanning:boolean;lastScan:any};fallback:(req:IncomingMessage,res:ServerResponse)=>void}){
 const {store}=options;
 return async(req:IncomingMessage,res:ServerResponse)=>{
  const port=options.port(),origin=`http://127.0.0.1:${port}`;
  const host=req.headers.host;if(host!==`127.0.0.1:${port}`&&host!==`localhost:${port}`){send(res,403,{error:'Loopback host required.'});return;}
  if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress??'')){send(res,403,{error:'Loopback connection required.'});return;}
  if(req.url?.startsWith('/api/')){
   const allowed=[origin,`http://localhost:${port}`];
   if((req.headers.origin&&!allowed.includes(req.headers.origin))||req.headers['sec-fetch-site']==='cross-site'){send(res,403,{error:'Same-origin access required.'});return;}
   if(req.method==='POST'&&(!req.headers.origin||!allowed.includes(req.headers.origin)||!req.headers['content-type']?.startsWith('application/json'))){send(res,403,{error:'Same-origin JSON mutation required.'});return;}
   try{
    const route=req.url.split('?')[0];
    if(req.method==='GET'&&route==='/api/snapshot'){send(res,200,{...store.snapshot(),...options.scanState()});return;}
    // Scan failures never echo SQL, remote or exception text; only the fixed busy message is passed through.
    if(req.method==='POST'&&route==='/api/scan'){let result;try{result=await options.scan();}catch(e){send(res,e instanceof ScanBusyError?409:500,{error:e instanceof ScanBusyError?e.message:'Source check could not run. Last-known results are retained.'});return;}send(res,200,result);return;}
    if(req.method==='POST'&&route==='/api/action'){const b=await body(req);store.action(b.id,b.action,b.value);send(res,200,{ok:true});return;}
    if(req.method==='POST'&&route==='/api/decision'){send(res,200,store.decision(await body(req)));return;}
    if(req.method==='POST'&&route==='/api/settings'){send(res,200,store.updateSettings(await body(req)));return;}
    if(req.method==='GET'&&route==='/api/profile'){send(res,200,store.profileView());return;}
    if(req.method==='POST'&&route==='/api/profile'){send(res,200,store.updateProfile(await body(req)));return;}
    if(req.method==='POST'&&route==='/api/profile/legacy'){send(res,200,store.resolveLegacy(await body(req)));return;}
    if(req.method==='POST'&&route==='/api/age-override'){send(res,200,store.ageOverride(await body(req)));return;}
    // Interest learning: Interested signal, deliberate Replace, exact Undo, on/pause/reset and scoped explicit instructions.
    const learning={'/api/learning/interest':'interest','/api/learning/replace':'replace','/api/learning/undo':'undo','/api/learning/control':'control','/api/learning/instruction':'instruction'} as const;
    if(req.method==='POST'&&Object.hasOwn(learning,route)){const command=learning[route as keyof typeof learning];send(res,200,store.learning[command](await body(req)));return;}
    send(res,404,{error:'Unknown route.'});
   }catch(e){
    // Error messages never echo request bodies or profile values.
    send(res,e instanceof ConflictError?409:400,{error:(e as Error).message,...(e instanceof ProfileError&&e.field?{field:e.field}:{}),...(e instanceof ConflictError?{reload:true}:{})});
   }
   return;
  }
  res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Content-Type-Options','nosniff');options.fallback(req,res);
 };
}
