import {PARTS} from './domain.ts';
// Plain Sources-view text for issue #7 calendar evidence, kept separate from the listing formatters so source dates always
// carry the year. Live responses show their read time; dated archives show original capture and later import separately.
const ZONE='America/New_York';
export const sourceDate=(stamp:string)=>`${new Intl.DateTimeFormat('en-US',{timeZone:ZONE,month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'}).format(new Date(stamp))} ET`;
export const sourceDay=(v:string)=>new Date(`${v}T12:00:00Z`).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'});
export const ORDER_LABELS:Record<string,string>={ascending:'Earliest first',descending:'Latest first',unsorted:'Mixed order','n/a':'Not applicable'};
export const spanText=(r:{count:number;earliest:string|null;latest:string|null},format:(v:string)=>string)=>r.count?`${r.count} (${format(r.earliest!)}${r.latest!==r.earliest?` to ${format(r.latest!)}`:''})`:'0';
export const originText=(a:any)=>a.origin==='archived'?`dated archive captured ${sourceDate(a.observedAt)}, imported ${sourceDate(a.recordedAt)}`:`live response read ${sourceDate(a.observedAt??a.recordedAt)}`;
export const latestCheckText=(a:any)=>a.outcome==='failed'?`${a.label} · ${sourceDate(a.recordedAt)}`:`${a.label} · ${originText(a)}`;
export const historyText=(h:any)=>h.outcome==='failed'?`${h.label} · checked ${sourceDate(h.recordedAt)}`:`${h.label} · ${originText(h)}${h.accepted!=null?` · ${h.accepted} accepted of ${h.returned}`:''}`;
export function comparisonText(c:any){
 if(c.status==='compared')return `${c.added} new · ${c.notObservedInNewer} not seen this time · ${c.changedCommon} changed · ${c.unchangedCommon} unchanged, compared with the check of ${sourceDate(c.previousRecordedAt)}. Not seen does not mean cancelled${c.previousPartial||c.currentPartial?'; a partial response makes this comparison weaker':''}.`;
 if(c.status==='revision-changed')return 'Not compared: the earlier check was read with a different parser version, so differences are unknown.';
 if(c.status==='unavailable')return 'The earlier response is no longer retained for comparison.';
 return 'No earlier comparable check.';
}
export const revisionText=(s:any)=>s.revisionCurrent?null:`These figures were measured when the response arrived (parser ${s.parserRevision}); the parser has since changed (now ${s.currentParserRevision}), so they reflect the earlier reading.`;
export function crossFeedText(cross:any){
 if(cross.status!=='available')return `Feed overlap: unavailable. ${cross.reason}`;
 const side=(part:'prcr'|'arts')=>`${PARTS[part].name}: ${originText(cross[part])}${cross[part].partial?' (partial)':''}`;
 const archived=cross.prcr.origin==='archived'||cross.arts.origin==='archived';
 return `Feed overlap: ${cross.common} listings appear in both latest successful responses; ${cross.agree} agree and ${cross.conflict} differ. ${side('prcr')}. ${side('arts')}. ${cross.sameScan?'Same check, read one after the other':'Different checks'}, not at the same moment${archived?'; a dated archive is an earlier capture, not a new read':''}. Overlap does not show which feed is correct or complete.`;
}
