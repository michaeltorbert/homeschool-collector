// SYNTHETIC hostile worker for extraction-isolation tests. The first input byte selects the behavior:
// s = spin forever (wall-clock timeout), m = allocate until the heap limit, t = throw with sentinel text.
import {workerData} from 'node:worker_threads';
const mode=String.fromCharCode(workerData.data[0]);
if(mode==='s')for(;;){}
if(mode==='m'){const keep=[];for(;;)keep.push(new Array(1e6).fill(Math.random()));}
if(mode==='t')throw new Error('SENTINEL worker failure text');
