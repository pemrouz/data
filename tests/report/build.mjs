import {readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import {execSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {dirname,join} from 'node:path';
const HERE=dirname(fileURLToPath(import.meta.url));
process.chdir(join(HERE,'..','..'));

const reg = JSON.parse(readFileSync('tests/registry.json','utf8'));
const migratedFiles = new Set(reg.map(r=>r.file));
const typeOf = f => f.endsWith('.perf.ts')?'perf':(f.startsWith('tests/')&&f.endsWith('.spec.ts'))?'e2e':'unit';
const subjectOf = f => {let m=f.match(/^operators\/([^/]+)\//);if(m)return m[1];
  if(f.startsWith('render/'))return 'render';if(f.startsWith('devtools/'))return 'devtools';
  if(f.startsWith('jsx/'))return 'jsx';if(f.startsWith('experiments/'))return 'experiments';
  if(f.startsWith('tests/'))return f.replace(/^tests\//,'').replace(/\.spec\.ts$/,'');
  return f.replace(/\.(test|perf)\.ts$/,'');};

const records=[];
for(const r of reg) records.push({file:r.file,type:typeOf(r.file),subject:r.op,guarantee:r.guarantee,
  trigger:r.trigger||null,shape:r.shape||null,via:r.via||[],issue:r.issue||null,chain:r.chain||null,
  asserts:r.asserts,migrated:true,title:r.title});

const VERB=/\b(BU1|BU2|BI0A|BI0|BI2|BR1A|BR1|BR2|BH1|BF0|BMV1|XU0|XR0)\b/g;
function guess(file,title){
  const t=title,type=typeOf(file),subj=subjectOf(file);
  let g;
  if(type==='perf') g='Efficiency';
  else if(/dedup/i.test(t)) g='Identity';
  else if(/O\(1\)|O\(n\)|O\(N\)|O\(Δ\)|complexity/i.test(t)) g='Efficiency';
  else if(/crash|throw|ghost|\bNaN\b|undefined|stale|no dup|duplicat|sparse/i.test(t)) g='Robustness';
  else if(/emits|change[- ]stream|connect\(|\bBMV1\b|record stream|event shape/i.test(t)) g='Fidelity';
  else if(/→|downstream|composed|follows window|chained/i.test(t)) g='Propagation';
  else if(/align|position|shift|lockstep|splice|\bindex\b|\bC\d+\b|hole|re-?key/i.test(t)) g='Alignment';
  else if(/re-?point|swap|\blink|\bmatches\b|identity/i.test(t)) g='Identity';
  else { if(subj==='sort') g='Order';
    else if(subj==='aggregate'||subj==='length'||subj==='reduce') g='Reduction';
    else g='Selection'; }
  if(type==='e2e'){ if(/identity|no dup|duplicat|stale|reorder/i.test(t)) g='Alignment';
    else if(/crash|error|throw/i.test(t)) g='Robustness'; else g='Propagation'; }
  let tr;
  if(type==='perf'){ if(/setup|build/i.test(t))tr='construct'; else if(/brush|drag|frames/i.test(t))tr='brush';
    else if(/batch|patch/i.test(t))tr='batch'; else if(/insert/i.test(t))tr='insert';
    else if(/remove|delete/i.test(t))tr='remove'; else if(/update/i.test(t))tr='edit'; else tr='scale'; }
  else { if(/brush|drag/i.test(t))tr='brush';
    else if(/widen|narrow|bound|extent|reactive bound|threshold|point range/i.test(t))tr='bound-move';
    else if(/in-place|\bBU2\b|crosses|whole-row|\bBU1\b|edit/i.test(t))tr='edit';
    else if(/insert/i.test(t)&&/remove|delete/i.test(t))tr='insert/remove';
    else if(/insert/i.test(t))tr='insert'; else if(/remove|delete/i.test(t))tr='remove';
    else if(/batch|patch/i.test(t))tr='batch'; else if(/dedup/i.test(t))tr='dedup-call';
    else if(/re-?point|swap|link/i.test(t))tr='re-point'; else tr='construct'; }
  let shape=null; const a=/\barray/i.test(t),o=/\bobject/i.test(t);
  if(a&&o)shape='array+object';else if(a)shape='array';else if(o)shape='object';else if(/\bscalar/i.test(t))shape='scalar';
  const via=[...new Set((t.match(VERB)||[]))];
  if(/\bhole/i.test(t)&&!via.length)via.push('hole'); if(/window/i.test(t))via.push('window');
  let issue=null,m=t.match(/\((C\d+)\)/)||t.match(/\((P\d+)\)/)||t.match(/\b(C\d+)\b/);
  if(m)issue=m[1];else{m=t.match(/\(#(\d+)\)/);if(m)issue='#'+m[1];}
  const ch=(t.match(/([a-z]+(?:\s*→\s*[a-z/()]+)+)/i)||[])[0]||null;
  let asserts=t.replace(/\s*\((C\d+|P\d+|#\d+)\)\s*$/,'').trim();
  return {file,type,subject:subj,guarantee:g,trigger:tr,shape,via,issue,chain:ch&&/→/.test(ch)?ch:null,asserts,migrated:false,title};
}

const files=execSync("git ls-files '*.test.ts' '*.perf.ts' 'tests/*.spec.ts'",{encoding:'utf8'}).trim().split('\n');
const reTitle=/\b(test|it)(?:\.(skip|only|todo))?\s*\(\s*(['"`])((?:\\.|(?!\3).)*)\3/g;
for(const f of files){ if(migratedFiles.has(f))continue;
  const src=readFileSync(f,'utf8');let mm;
  while((mm=reTitle.exec(src))) records.push(guess(f,mm[4].replace(/\\(['"`])/g,'$1'))); }

records.forEach(r=>{ if(r.type==='e2e') r.subject='e2e'; });
let RUN=null; try{ RUN=JSON.parse(readFileSync('tests/report/results.json','utf8')); }catch(e){}
records.forEach(r=>{ const x=RUN&&RUN.results[r.title]; r.status = x?x.status:'unrun'; r.ms = x?x.ms:null; });
const GUARANTEES=['Selection','Order','Reduction','Identity','Alignment','Propagation','Fidelity','Efficiency','Robustness'];
const GABBR={Selection:'Sel',Order:'Ord',Reduction:'Red',Identity:'Idn',Alignment:'Aln',Propagation:'Prop',Fidelity:'Fid',Efficiency:'Eff',Robustness:'Rob'};
const meta={total:records.length,authoritative:records.filter(r=>r.migrated).length,
  byType:{unit:records.filter(r=>r.type==='unit').length,perf:records.filter(r=>r.type==='perf').length,e2e:records.filter(r=>r.type==='e2e').length},
  guarantees:GUARANTEES,gabbr:GABBR,order:['core','index','differential','entry'],run:RUN?RUN.summary:null};

mkdirSync('tests/report',{recursive:true});
const html=`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>data · tests</title><style>${readFileSync(join(HERE,'report.css'),'utf8')}</style></head><body>
<div class="topbar">
  <span class="brand"><span class="d">data</span> <span class="s">/ tests</span></span>
  <div class="search"><svg width="15" height="15" viewBox="0 0 16 16" fill="none"><circle cx="7" cy="7" r="5" stroke="currentColor" stroke-width="1.6"/><path d="M11 11l3 3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
    <input id="q" placeholder="Filter assertions, operators, guarantees, triggers…" autocomplete="off" spellcheck="false"></div>
  <div class="seg" id="pills">
    <span class="pill" data-t="unit"><span class="dotc u"></span>unit</span>
    <span class="pill" data-t="perf"><span class="dotc p"></span>perf</span>
    <span class="pill" data-t="e2e"><span class="dotc e"></span>e2e</span></div>
  <button class="btn" id="failonly" title="show only failing tests">failing</button>
  <button class="btn" id="authonly" title="show only authoritative (spec()) rows">✓ only</button>
  <div class="stats" id="stats"></div>
</div>
<div class="main">
  <div class="mxwrap">
    <p class="mxtitle">coverage · <b>subject × guarantee</b> · <span id="mxcount"></span> tests · click a cell / row / column to drill</p>
    <div id="mx"></div>
  </div>
  <div class="drill"><div class="bc" id="bc"></div><div id="drillbody"></div></div>
</div>
<div class="statusbar"><span id="status"></span>
  <span class="right"><b>${meta.authoritative}</b> authoritative · rest heuristic · <kbd>/</kbd> filter · <kbd>Esc</kbd> clear</span></div>
<script>
const DATA=${JSON.stringify(records)};
const META=${JSON.stringify(meta)};
${readFileSync(join(HERE,'app.js'),'utf8')}
</script></body></html>`;
writeFileSync('tests/report/explorer.html',html);
console.log('wrote explorer.html',html.length,'bytes ·',records.length,'records,',meta.authoritative,'authoritative');
