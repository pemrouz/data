import {execSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname,join} from 'node:path';
const HERE=dirname(fileURLToPath(import.meta.url));
process.chdir(join(HERE,'..','..'));
const files = 'core.test.ts entry.test.ts index.test.ts differential.test.ts operators/*/*.test.ts render/*.test.ts jsx/*.test.ts devtools/*.test.ts';
let out='';
try{
  out = execSync('node --experimental-strip-types --test --test-reporter=tap '+files,
    {encoding:'utf8', maxBuffer:64*1024*1024, stdio:['ignore','pipe','pipe']});
}catch(e){ out = (e.stdout||'') + (e.stderr||''); }  // nonzero exit when a test fails
const results={}; let cur=null;
for(const ln of out.split('\n')){
  const m=ln.match(/^(ok|not ok) \d+ - (.*)$/);
  if(m){ let title=m[2], status=m[1]==='ok'?'pass':'fail';
    if(/#\s*SKIP/i.test(title)){status='skip';title=title.replace(/\s*#\s*SKIP.*$/i,'');}
    else if(/#\s*TODO/i.test(title)){status='todo';title=title.replace(/\s*#\s*TODO.*$/i,'');}
    title=title.trim(); cur=title; results[title]={status,ms:null}; continue; }
  if(cur){ const d=ln.match(/duration_ms:\s*([\d.]+)/); if(d){results[cur].ms=+d[1];cur=null;} }
}
const vals=Object.values(results);
const summary={
  pass:vals.filter(r=>r.status==='pass').length,
  fail:vals.filter(r=>r.status==='fail').length,
  skip:vals.filter(r=>r.status==='skip').length,
  total:vals.length,
  ms:Math.round(vals.reduce((s,r)=>s+(r.ms||0),0)),
  when:new Date().toISOString(),
};
writeFileSync('proto/test-report/results.json', JSON.stringify({summary,results},null,2));
console.log('results.json —', summary.pass+'p/'+summary.fail+'f/'+summary.skip+'s of', summary.total, 'in', summary.ms+'ms');
