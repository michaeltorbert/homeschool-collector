// Pure, date-only age arithmetic. No Date arithmetic, host timezone or invented birthdays:
// every profile is a set (closed interval) of feasible Gregorian birthdays.
export const AGE_ZONE='America/New_York';
// Product input limit for the one local child, not a provider eligibility rule.
export const AGE_DOMAIN={min:0,max:25} as const;
export const PROFILE_ALGORITHM='age-profile-v1';
export interface Civil {y:number;m:number;d:number}
export const isLeap=(y:number)=>y%4===0&&(y%100!==0||y%400===0);
export const daysInMonth=(y:number,m:number)=>m===2?(isLeap(y)?29:28):[31,28,31,30,31,30,31,31,30,31,30,31][m-1];
const pad=(n:number,w=2)=>String(n).padStart(w,'0');
export function parseCivil(value:unknown):Civil|null{
 if(typeof value!=='string')return null;
 const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(value);if(!m)return null;
 const y=Number(m[1]),mo=Number(m[2]),d=Number(m[3]);
 if(y<1||mo<1||mo>12||d<1||d>daysInMonth(y,mo))return null;
 return {y,m:mo,d};
}
export const formatCivil=({y,m,d}:Civil)=>`${pad(y,4)}-${pad(m)}-${pad(d)}`;
// Days since 1970-01-01 in the proleptic Gregorian calendar (integer civil-from-days algorithm).
export function dayNumber({y,m,d}:Civil){
 const yy=y-(m<=2?1:0),era=Math.floor(yy/400),yoe=yy-era*400;
 const doy=Math.floor((153*(m+(m>2?-3:9))+2)/5)+d-1;
 return era*146097+yoe*365+Math.floor(yoe/4)-Math.floor(yoe/100)+doy-719468;
}
export function fromDayNumber(n:number):Civil{
 const z=n+719468,era=Math.floor(z/146097),doe=z-era*146097;
 const yoe=Math.floor((doe-Math.floor(doe/1460)+Math.floor(doe/36524)-Math.floor(doe/146096))/365);
 const doy=doe-(365*yoe+Math.floor(yoe/4)-Math.floor(yoe/100)),mp=Math.floor((5*doy+2)/153);
 const d=doy-Math.floor((153*mp+2)/5)+1,m=mp+(mp<10?3:-9);
 return {y:yoe+era*400+(m<=2?1:0),m,d};
}
export const compareCivil=(a:Civil,b:Civil)=>dayNumber(a)-dayNumber(b);
// The civil date in New York for an instant, independent of the host timezone.
export function civilDateIn(now:Date,zone=AGE_ZONE){
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now).map(p=>[p.type,p.value]));
 return `${parts.year}-${parts.month}-${parts.day}`;
}
// Completed years at a reference date. A February 29 birthday has two anniversary interpretations in
// common years (February 28 or March 1); both are returned unless they agree.
export function completedYears(birth:Civil,ref:Civil):number[]{
 const base=ref.y-birth.y,before=(m:number,d:number)=>ref.m<m||(ref.m===m&&ref.d<d);
 if(birth.m===2&&birth.d===29&&!isLeap(ref.y)){const feb28=base-(before(2,28)?1:0),mar1=base-(before(3,1)?1:0);return feb28===mar1?[feb28]:[mar1,feb28];}
 return [base-(before(birth.m,birth.d)?1:0)];
}
export type ProfileInput=
 {kind:'unknown'}|
 {kind:'birth-date';birthDate:string}|
 {kind:'birth-month';year:number;month:number}|
 {kind:'birth-year';year:number}|
 {kind:'age-as-of';age:number;asOf:string};
export type ProfileKind=ProfileInput['kind'];
export const PROFILE_FIELDS:Record<ProfileKind,string[]>={'unknown':[],'birth-date':['birthDate'],'birth-month':['year','month'],'birth-year':['year'],'age-as-of':['age','asOf']};
export const PROFILE_LABELS:Record<ProfileKind,string>={'age-as-of':'Age in completed years as of a date','birth-date':'Exact birthday','birth-month':'Birth month and year','birth-year':'Birth year','unknown':'Unknown / not set'};
export interface Feasible {earliest:string;latest:string}
export class ProfileError extends Error {constructor(message:string,public field:string|null=null){super(message);}}
const integer=(v:unknown):v is number=>typeof v==='number'&&Number.isInteger(v);
function ageAsOfInterval(age:number,asOf:Civil):[number,number]{
 const has=(n:number)=>completedYears(fromDayNumber(n),asOf).includes(age);
 const y=asOf.y-age,approx=dayNumber({y,m:asOf.m,d:Math.min(asOf.d,daysInMonth(y,asOf.m))});
 let latest=approx+3,earliest=approx-370;
 while(!has(latest))latest--;
 while(!has(earliest))earliest++;
 return [earliest,latest];
}
// Validates against the immutable anchor civil date of the revision being created. Feasible sets are
// truncated at that anchor (a child cannot be born after it), never at a later evaluation date.
export function validateProfile(input:unknown,anchor:string):{profile:ProfileInput;feasible:Feasible|null}{
 const anchorDate=parseCivil(anchor);if(!anchorDate)throw new ProfileError('Invalid profile anchor date.');
 if(!input||typeof input!=='object'||Array.isArray(input))throw new ProfileError('Choose how to describe the child’s age.','kind');
 const value=input as Record<string,unknown>,kind=value.kind as ProfileKind;
 if(typeof kind!=='string'||!Object.prototype.hasOwnProperty.call(PROFILE_FIELDS,kind))throw new ProfileError('Unsupported age description.','kind');
 const allowed=['kind',...PROFILE_FIELDS[kind]];
 for(const key of Object.keys(value))if(!allowed.includes(key))throw new ProfileError(`Unsupported profile field: ${key}.`,key);
 for(const key of PROFILE_FIELDS[kind])if(value[key]===undefined||value[key]===null||value[key]==='')throw new ProfileError(`Required: ${key}.`,key);
 const today=dayNumber(anchorDate);let profile:ProfileInput,earliest:number,latest:number;
 if(kind==='unknown')return {profile:{kind},feasible:null};
 if(kind==='birth-date'){
  const birth=parseCivil(value.birthDate);if(!birth)throw new ProfileError('Enter a real calendar date as YYYY-MM-DD.','birthDate');
  earliest=latest=dayNumber(birth);if(latest>today)throw new ProfileError(`A birthday cannot be after ${anchor}.`,'birthDate');
  profile={kind,birthDate:formatCivil(birth)};
 }else if(kind==='birth-month'){
  if(!integer(value.year)||value.year<1)throw new ProfileError('Enter a four-digit birth year.','year');
  if(!integer(value.month)||value.month<1||value.month>12)throw new ProfileError('Choose a month from 1 to 12.','month');
  earliest=dayNumber({y:value.year,m:value.month,d:1});latest=Math.min(today,dayNumber({y:value.year,m:value.month,d:daysInMonth(value.year,value.month)}));
  if(earliest>today)throw new ProfileError(`A birth month cannot be after ${anchor}.`,'month');
  profile={kind,year:value.year,month:value.month};
 }else if(kind==='birth-year'){
  if(!integer(value.year)||value.year<1)throw new ProfileError('Enter a four-digit birth year.','year');
  earliest=dayNumber({y:value.year,m:1,d:1});latest=Math.min(today,dayNumber({y:value.year,m:12,d:31}));
  if(earliest>today)throw new ProfileError(`A birth year cannot be after ${anchor}.`,'year');
  profile={kind,year:value.year};
 }else{
  if(!integer(value.age)||value.age<AGE_DOMAIN.min||value.age>AGE_DOMAIN.max)throw new ProfileError(`Enter whole completed years from ${AGE_DOMAIN.min} to ${AGE_DOMAIN.max}.`,'age');
  const asOf=parseCivil(value.asOf);if(!asOf)throw new ProfileError('Enter a real as-of date as YYYY-MM-DD.','asOf');
  if(dayNumber(asOf)>today)throw new ProfileError(`The as-of date cannot be after ${anchor}.`,'asOf');
  [earliest,latest]=ageAsOfInterval(value.age,asOf);latest=Math.min(latest,today);
  profile={kind,age:value.age,asOf:formatCivil(asOf)};
 }
 if(earliest>latest)throw new ProfileError('These details contradict each other.','kind');
 // Reject only when every feasible birthday is outside the documented product input domain at the anchor.
 if(Math.min(...completedYears(fromDayNumber(latest),anchorDate))>AGE_DOMAIN.max)throw new ProfileError(`This preview supports children aged ${AGE_DOMAIN.min}–${AGE_DOMAIN.max}.`,PROFILE_FIELDS[kind][0]);
 return {profile,feasible:{earliest:formatCivil(fromDayNumber(earliest)),latest:formatCivil(fromDayNumber(latest))}};
}
// Range of possible completed ages at a reference date across every feasible birthday and both
// February 29 interpretations. Ages are monotone in birthday, so the endpoints bound the set.
export function possibleAges(feasible:Feasible,reference:string){
 const ref=parseCivil(reference),earliest=parseCivil(feasible.earliest),latest=parseCivil(feasible.latest);
 if(!ref||!earliest||!latest)return null;
 return {min:Math.min(...completedYears(latest,ref)),max:Math.max(...completedYears(earliest,ref))};
}
export interface AgeBounds {min:number|null;max:number|null}
// Inclusive completed-year bounds. All feasible ages satisfy => meets; none => outside; overlap => unknown.
export function compareBounds(bounds:AgeBounds,ages:{min:number;max:number}):'meets'|'outside'|'unknown'{
 const ok=(a:number)=>(bounds.min===null||a>=bounds.min)&&(bounds.max===null||a<=bounds.max);
 if(ok(ages.min)&&ok(ages.max))return 'meets';
 if((bounds.max!==null&&ages.min>bounds.max)||(bounds.min!==null&&ages.max<bounds.min))return 'outside';
 return 'unknown';
}
export function describeProfile(profile:ProfileInput){
 const months=['January','February','March','April','May','June','July','August','September','October','November','December'];
 switch(profile.kind){
  case 'unknown':return 'Unknown';
  case 'birth-date':return `Born ${profile.birthDate}`;
  case 'birth-month':return `Born ${months[profile.month-1]} ${profile.year}`;
  case 'birth-year':return `Born in ${profile.year}`;
  case 'age-as-of':return `${profile.age} completed year${profile.age===1?'':'s'} old as of ${profile.asOf}`;
 }
}
