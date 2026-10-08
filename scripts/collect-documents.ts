import {mkdirSync} from 'node:fs';
import {DocumentStore,DOCUMENTS_DB_PATH,DocumentQueryError,StaleFenceError} from '../server/documents/store.ts';
import {DocumentCollector} from '../server/documents/collector.ts';
// Structured CLI over the same persisted admission, pacing and sticky-stop gates as the server timer.
// There is intentionally no force, clear, reset or unblock command. Output is JSON; errors are fixed messages.
const USAGE=`Usage: npm run documents -- <command>
  run                      Run a check only if the persisted gates admit one
  status                   Lane state, last run and per-source evidence
  list [--q text] [--code CODE] [--doc ID] [--view display|latest] [--limit N] [--cursor N]
  search <text>            Same as list --q
  detail <candidateId>     Candidate fields, spans, block text and source evidence
  source <documentId>      Document links, attempts, versions and parses
  replay <documentId>      Read-only re-extraction of retained bytes compared with the stored parse
  reparse                  Reprocess retained bytes under the current parser revision (no network)`;
function flags(args:string[]){const out:Record<string,string>={};for(let i=0;i<args.length;i+=2){const k=args[i];if(!/^--(q|code|doc|view|limit|cursor)$/.test(k)||args[i+1]===undefined)throw new DocumentQueryError('Unknown or incomplete option.');out[k.slice(2)]=args[i+1];}return out;}
const print=(v:unknown)=>console.log(JSON.stringify(v,null,2));
const [command,...args]=process.argv.slice(2);
if(!command||command==='help'||command==='--help'){console.log(USAGE);process.exit(command?0:2);}
mkdirSync(new URL('../data/',import.meta.url),{recursive:true});
const store=new DocumentStore(DOCUMENTS_DB_PATH);
const collector=new DocumentCollector(store);
process.once('SIGINT',()=>{void collector.stop();});
let code=0;
try{
 switch(command){
  case 'run':print(await collector.runIfDue('cli'));break;
  case 'status':print(store.status());break;
  case 'list':print(store.listCandidates(flags(args)));break;
  case 'search':print(store.listCandidates({q:args.join(' ')}));break;
  case 'detail':{const d=store.candidateDetail(args[0]??'');if(d)print(d);else{print({error:'Not found.'});code=1;}break;}
  case 'source':{const d=store.sourceDetail(args[0]??'');if(d)print(d);else{print({error:'Not found.'});code=1;}break;}
  case 'replay':{if(!/^[1-9]\d{0,8}$/.test(args[0]??''))throw new DocumentQueryError('Document ID must be numeric.');print(await collector.replay(Number(args[0])));break;}
  case 'reparse':print(await collector.reparse());break;
  default:console.log(USAGE);code=2;
 }
}catch(e){
 print({error:e instanceof DocumentQueryError?e.message:e instanceof StaleFenceError?'Another collector run holds the lease; nothing was changed.':'Command failed; retained evidence is unchanged.'});code=1;
}finally{store.close();}
process.exit(code);
