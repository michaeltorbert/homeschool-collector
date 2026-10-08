import test from 'node:test';
import assert from 'node:assert/strict';
import {documentLink,parseRobots,robotsAllows,linkInventory,looksLikeChallenge,ROBOTS_TOKEN} from '../server/documents/policy.ts';
// SYNTHETIC URLs, robots policies and HTML (no network).
const BASE='https://www.fuquay-varina.org/311/Programs';
test('only exact-host HTTPS numeric DocumentCenter/View links are accepted; slug aliases share the numeric ID',()=>{
 assert.deepEqual(documentLink('/DocumentCenter/View/16912/2026-Sept---Dec-Brochure-Online-Version',BASE),{docId:16912,url:'https://www.fuquay-varina.org/DocumentCenter/View/16912/2026-Sept---Dec-Brochure-Online-Version'});
 assert.deepEqual(documentLink('https://www.fuquay-varina.org/DocumentCenter/View/16912',BASE),{docId:16912,url:'https://www.fuquay-varina.org/DocumentCenter/View/16912'});
 assert.equal(documentLink('DocumentCenter/View/5/x',BASE),null,'relative to /311/ is not a DocumentCenter path');
 for(const bad of ['http://www.fuquay-varina.org/DocumentCenter/View/1/x','https://fuquay-varina.org/DocumentCenter/View/1','https://www.fuquay-varina.org.evil.example/DocumentCenter/View/1',
  'https://WWW.FUQUAY-VARINA.ORG/DocumentCenter/View/1','https://user:pw@www.fuquay-varina.org/DocumentCenter/View/1','https://www.fuquay-varina.org:8443/DocumentCenter/View/1',
  '/DocumentCenter/View/1/x?token=abc','/DocumentCenter/View/1/x#p2','/DocumentCenter/View/1/x?','/DocumentCenter/View/abc','/DocumentCenter/View/0/x','/DocumentCenter/View/1/a/b',
  '/foo/../DocumentCenter/View/1','/DocumentCenter/View/1/%2e%2e','/DocumentCenter/View/1/%2Fetc','/DocumentCenter/View/1/caf%C3%A9','\\DocumentCenter\\View\\1','/DocumentCenter/View/1/ x',
  '//evil.example/DocumentCenter/View/1','javascript:alert(1)','https://ncfuquayvarinaweb.myvscloud.com/webtrac/web/splash.html','']){
  assert.equal(documentLink(bad,BASE),null,bad);
 }
});
test('robots: specific group overrides *, longest match wins, allow wins ties, wildcards/$ and case-sensitive paths',()=>{
 const p=parseRobots(['user-agent: Baiduspider','Disallow: /','User-agent: *','Disallow: /Search','Disallow: /admin','Sitemap: /sitemap.xml','Disallow: /RSS.aspx',
  'User-agent: Siteimprove','Crawl-delay: 20'].join('\n'));
 assert.ok(p.ok&&p.group==='wildcard');
 assert.equal(robotsAllows(p,'/311/Programs'),true);assert.equal(robotsAllows(p,'/DocumentCenter/View/1/x'),true);
 assert.equal(robotsAllows(p,'/Search'),false);assert.equal(robotsAllows(p,'/Searchable'),false);assert.equal(robotsAllows(p,'/search'),true);
 const s=parseRobots([`User-agent: ${ROBOTS_TOKEN}`,'Disallow: /DocumentCenter/','Allow: /DocumentCenter/View/','Disallow: /*.pdf$','User-agent: *','Disallow: /'].join('\n'));
 assert.ok(s.ok&&s.group==='specific');
 assert.equal(robotsAllows(s,'/DocumentCenter/View/1/x'),true);assert.equal(robotsAllows(s,'/DocumentCenter/Index'),false);
 assert.equal(robotsAllows(s,'/a/b.pdf'),false);assert.equal(robotsAllows(s,'/a/b.pdfx'),true);assert.equal(robotsAllows(s,'/311/Programs'),true);
 const tie=parseRobots(['User-agent: *','Disallow: /x','Allow: /x'].join('\n'));assert.equal(robotsAllows(tie,'/x'),true);
 const all=parseRobots(['User-agent: *','Disallow: /'].join('\n'));assert.equal(robotsAllows(all,'/311/Programs'),false);
 assert.equal(robotsAllows(parseRobots(''),'/anything'),true);
});
test('robots: unsupported applicable policy fails closed; unrelated groups do not',()=>{
 assert.deepEqual(parseRobots('User-agent: *\nthis line has no separator'),{ok:false,reason:'malformed'});
 assert.deepEqual(parseRobots('User-agent: *\nRequest-rate: 1/5'),{ok:false,reason:'unsupported-field'});
 assert.deepEqual(parseRobots('User-agent: *\nCrawl-delay: 45'),{ok:false,reason:'unsupported-crawl-delay'});
 assert.deepEqual(parseRobots('User-agent: *\nCrawl-delay: soon'),{ok:false,reason:'unsupported-crawl-delay'});
 assert.deepEqual(parseRobots('User-agent: *\nDisallow: relative'),{ok:false,reason:'unsupported-pattern'});
 const other=parseRobots('User-agent: OtherBot\nRequest-rate: 1/5\nCrawl-delay: 99\nUser-agent: *\nCrawl-delay: 10\nDisallow: /admin');
 assert.ok(other.ok&&other.crawlDelayMs===10_000);
 assert.equal(robotsAllows({ok:false,reason:'malformed'},'/311/Programs'),false);
});
test('SOL-DOC-004: duplicates are removed before the link cap; overflow counts distinct links and numeric IDs and marks truncation',()=>{
 const a=(path:string)=>`<a href="${path}">x</a>`;
 // Under the cap: repeated anchors and slug aliases never trigger truncation.
 const under=[...Array.from({length:150},(_,i)=>a(`/DocumentCenter/View/${i+1}/D`)),...Array.from({length:150},(_,i)=>a(`/DocumentCenter/View/${i+1}/D`)),...Array.from({length:40},(_,i)=>a(`/DocumentCenter/View/${i+1}/Alias`))];
 const u=linkInventory(`<body>${under.join('')}</body>`,BASE);
 assert.equal(u.documents.length,190);assert.equal(u.truncated,false);assert.deepEqual(u.truncatedReasons,[]);
 assert.equal(u.counts.documentLinksOmitted,0);assert.equal(u.counts.documentIdsOmitted,0);assert.equal(u.counts.anchors,340);
 // Over the cap: 201 distinct IDs, all repeated, plus aliases of a retained ID (1) and an omitted ID (201).
 const over=[...Array.from({length:201},(_,i)=>a(`/DocumentCenter/View/${i+1}/D`)),...Array.from({length:201},(_,i)=>a(`/DocumentCenter/View/${i+1}/D`)),a('/DocumentCenter/View/1/Alias'),a('/DocumentCenter/View/201/Alias'),a('/DocumentCenter/View/x/bad')];
 const o=linkInventory(`<body>${over.join('')}</body>`,BASE);
 assert.equal(o.documents.length,200);assert.equal(o.truncated,true);assert.deepEqual(o.truncatedReasons,['document-link-cap']);
 assert.equal(o.counts.documentLinksOmitted,3);assert.equal(o.counts.documentIdsOmitted,1);
 assert.equal(o.documents.some(d=>d.docId===201),false);
});
test('seed sanitizer keeps only a bounded link inventory: no scripts, queries, tokens or off-host URLs beyond the host',()=>{
 const html=`<html><head><title>Programs | Town</title><script>document.write('<a href="/DocumentCenter/View/999/Injected">x</a>')</script></head><body>
  <a href="/DocumentCenter/View/16912/2026-Sept---Dec-Brochure-Online-Version" target="_blank">Sept–Dec <b>Brochure</b></a>
  <a href="https://www.fuquay-varina.org/DocumentCenter/View/16912/Old-Slug">older slug</a>
  <a href="/DocumentCenter/View/16912/2026-Sept---Dec-Brochure-Online-Version">duplicate</a>
  <a href="https://online.flippingbook.com/view/576724837/?SENTINEL_QUERY=1">Fall and Spring Dance Brochure</a>
  <a href="/311/Programs-Brochure?x=SENTINEL_TOWN_QUERY">Program Brochures</a>
  <a href="https://ncfuquayvarinaweb.myvscloud.com/webtrac/web/splash.html?ccode=ArtSplash&amp;_csrf_token=SENTINELTOKEN">Register</a>
  <a href="/DocumentCenter/View/17/x?token=SENTINEL2">Brochure with token</a>
  <a href="javascript:alert('SENTINEL3')">brochure script</a><a>no href</a><template><a href="/DocumentCenter/View/55/T">t</a></template>
 </body></html>`;
 const inv=linkInventory(html,'https://www.fuquay-varina.org/1088/Dance-Class');
 assert.equal(inv.title,'Programs | Town');
 assert.deepEqual(inv.documents.map(d=>[d.docId,d.url,d.text]),[[16912,'https://www.fuquay-varina.org/DocumentCenter/View/16912/2026-Sept---Dec-Brochure-Online-Version','Sept–Dec Brochure'],[16912,'https://www.fuquay-varina.org/DocumentCenter/View/16912/Old-Slug','older slug']]);
 assert.deepEqual(inv.excluded.map(e=>[e.reason,e.host,e.path]),[['off-host','online.flippingbook.com',null],['town-non-document','www.fuquay-varina.org','/311/Programs-Brochure'],['town-non-document','www.fuquay-varina.org','/DocumentCenter/View/17/x'],['unsafe-url',null,null]]);
 assert.equal(inv.counts.scripts,1);assert.equal(inv.counts.registrationHost,1);assert.equal(inv.counts.tokenBearing,2);
 const stored=JSON.stringify(inv);
 for(const s of ['SENTINEL','_csrf_token','myvscloud','document.write','Injected','/DocumentCenter/View/55'])assert.equal(stored.includes(s),false,s);
 assert.equal(looksLikeChallenge(html),false);
 assert.equal(looksLikeChallenge('<html><head><title>Just a moment...</title></head></html>'),true);
});
