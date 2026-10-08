// Subprocess helper for the host-timezone independence test. Wholly synthetic inputs.
import {createHash} from 'node:crypto';
import {civilDateIn,validateProfile} from '../../src/age.ts';
import {assessAge,eventStartDate} from '../../src/ageEvidence.ts';
const hash=(v:string)=>createHash('sha256').update(v).digest('hex');
const instants=['2026-11-01T03:30:00Z','2026-11-01T05:30:00Z','2026-03-08T07:30:00Z'];
const anchors=instants.map(i=>civilDateIn(new Date(i)));
const utcEvent={title:'Synthetic class',description:'Ages 6-8 as of September 1, 2026.',recurring:false,start:{kind:'known',local:'2026-11-01T03:30:00Z',instant:'2026-11-01T03:30:00.000Z',zone:'UTC'}};
const zonedEvent={...utcEvent,start:{kind:'known',local:'2026-11-01T01:30:00',instant:'2026-11-01T05:30:00.000Z',zone:'America/New_York'}};
const eventDates=[utcEvent,zonedEvent].map(e=>(eventStartDate(e) as {date:string}).date);
const {feasible}=validateProfile({kind:'age-as-of',age:7,asOf:anchors[0]},anchors[0]);
const age=assessAge({event:utcEvent,representations:[{part:'prcr',event:utcEvent}]},{sourceVersion:1,calendarParserRevision:'synthetic',profile:{revisionId:'synthetic-revision',feasible},hash});
const hostDate=new Date('2026-11-01T03:30:00Z').getDate();
process.stdout.write(JSON.stringify({hostDate,result:{anchors,eventDates,feasible,status:age.status,identity:age.identity,outcome:age.outcomeSignature}}));
