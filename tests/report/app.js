var $=function(s){return document.querySelector(s)};
var esc=function(s){return String(s).replace(/[&<>]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;'}[c]})};
function hi(s,q){ if(!q) return esc(s); var i=String(s).toLowerCase().indexOf(q); if(i<0) return esc(s);
  return esc(s.slice(0,i))+'<mark>'+esc(s.slice(i,i+q.length))+'</mark>'+esc(s.slice(i+q.length)); }
var G=META.guarantees;
function gvar(g){return 'var(--g-'+g+')'}
function subjOrder(a,b){var O=META.order;var ia=O.indexOf(a),ib=O.indexOf(b);
  if(ia>=0||ib>=0)return (ia<0?99:ia)-(ib<0?99:ib);
  if(a==='e2e')return 1;if(b==='e2e')return -1;if(a==='experiments')return 1;if(b==='experiments')return -1;
  return a.localeCompare(b);}

$('#stats').innerHTML='<span class="stat"><b>'+META.total+'</b>tests</span>'+
  '<span class="stat"><span class="dotc u"></span><b>'+META.byType.unit+'</b></span>'+
  '<span class="stat"><span class="dotc p"></span><b>'+META.byType.perf+'</b></span>'+
  '<span class="stat"><span class="dotc e"></span><b>'+META.byType.e2e+'</b></span>';

// run summary in the status bar (left)
if(META.run){var R=META.run;
  $('#status').innerHTML='<span class="runsum"><span class="lbl">last run</span> <span class="ok">'+R.pass+' passed</span>'+
    (R.fail?' · <span class="bad">'+R.fail+' failed</span>':'')+(R.skip?' · <span class="sk">'+R.skip+' skipped</span>':'')+
    ' · '+R.ms+'ms · unit suite</span>';
} else $('#status').textContent='not run yet';

var types=new Set();
var authOnly=false, failOnly=false;
var sel=null, maxCell=1;

function recs(){ var q=$('#q').value.trim().toLowerCase();
  return DATA.filter(function(r){
    if(authOnly && !r.migrated) return false;
    if(failOnly && r.status!=='fail') return false;
    if(types.size && !types.has(r.type)) return false;
    if(!q) return true;
    return (r.asserts+' '+r.subject+' '+r.guarantee+' '+(r.trigger||'')+' '+(r.shape||'')+' '+(r.via||[]).join(' ')+' '+(r.issue||'')+' '+(r.chain||'')+' '+r.file).toLowerCase().indexOf(q)>=0;
  });
}

function renderMatrix(){
  var rs=recs();
  var subs=[];var seen={};rs.forEach(function(r){if(!seen[r.subject]){seen[r.subject]=1;subs.push(r.subject);}});
  subs.sort(subjOrder);
  var C={},F={}; subs.forEach(function(s){C[s]={};F[s]={};});
  var gtot={}; G.forEach(function(g){gtot[g]=0});
  rs.forEach(function(r){C[r.subject][r.guarantee]=(C[r.subject][r.guarantee]||0)+1; gtot[r.guarantee]++;
    if(r.status==='fail')F[r.subject][r.guarantee]=(F[r.subject][r.guarantee]||0)+1;});
  maxCell=1; subs.forEach(function(s){G.forEach(function(g){if((C[s][g]||0)>maxCell)maxCell=C[s][g];})});

  var tmpl='200px repeat('+G.length+', 1fr) 52px';
  var h='<div class="mx" style="grid-template-columns:'+tmpl+'">';
  h+='<div class="corner"></div>';
  G.forEach(function(g){h+='<div class="h" data-g="'+g+'" title="'+g+'" style="color:'+gvar(g)+'">'+g+'</div>';});
  h+='<div class="h htot" style="cursor:default">Σ</div>';
  subs.forEach(function(s){
    var rtot=0;G.forEach(function(g){rtot+=C[s][g]||0});
    h+='<div class="rh" data-subj="'+esc(s)+'">'+esc(s)+'<span class="rt">'+rtot+'</span></div>';
    G.forEach(function(g){
      var n=C[s][g]||0;
      if(!n){h+='<div class="cell empty"></div>';return;}
      var op=0.14+0.86*(n/maxCell);
      var auth=rs.some(function(r){return r.subject===s&&r.guarantee===g&&r.migrated;});
      var fails=F[s][g]||0;
      var selc=(sel&&sel.subj===s&&sel.g===g)?' sel':'';
      h+='<div class="cell'+selc+'" data-subj="'+esc(s)+'" data-g="'+g+'" '+
         'style="background-color:color-mix(in srgb,'+gvar(g)+' '+Math.round(op*100)+'%, transparent);color:'+(op>0.55?'#0d1117':'var(--text)')+'">'+
         n+(auth?'<span class="ck">✓</span>':'')+(fails?'<span class="failm" title="'+fails+' failing"></span>':'')+'</div>';
    });
    h+='<div class="tot">'+rtot+'</div>';
  });
  h+='<div class="tot gtot">Σ</div>';
  G.forEach(function(g){h+='<div class="tot gtot">'+gtot[g]+'</div>';});
  h+='<div class="tot gtot">'+rs.length+'</div>';
  h+='</div>';
  $('#mx').innerHTML=h;
  $('#mxcount').textContent=rs.length;
}

function leafHTML(r,q){
  var c='';
  if(r.chain)c+='<span class="chip chain">'+hi(r.chain,q)+'</span>';
  if(r.shape)c+='<span class="chip shape">'+esc(r.shape)+'</span>';
  (r.via||[]).forEach(function(v){c+='<span class="chip via">'+hi(v,q)+'</span>';});
  if(r.issue)c+='<span class="chip issue">'+hi(r.issue,q)+'</span>';
  var st=r.status||'unrun';
  var ms=(r.ms!=null)?'<span class="ms'+(r.ms>5?' slow':'')+'">'+r.ms.toFixed(1)+'ms</span>':'<span class="ms"></span>';
  return '<div class="dleaf"><span class="st '+st+'" title="'+st+'"></span>'+
    '<span class="adot" style="background:'+gvar(r.guarantee)+'"></span>'+
    '<span class="asserts">'+hi(r.asserts,q)+'</span><span class="chips">'+c+'</span>'+ms+
    '<span class="dfile">'+(r.migrated?'<span class="ck2" title="authoritative">✓</span>':'')+
    '<span title="'+esc(r.file)+'">'+esc(r.file.split('/').pop())+'</span></span></div>';
}
function renderDrill(){
  var q=$('#q').value.trim().toLowerCase();
  var bc=$('#bc'), body=$('#drillbody');
  if(!sel){ bc.innerHTML='<span class="hint">Select a cell, a row (operator), or a column (guarantee) above to drill in.</span>';
    body.innerHTML=''; return; }
  var rs=recs().filter(function(r){ if(sel.subj&&r.subject!==sel.subj)return false; if(sel.g&&r.guarantee!==sel.g)return false; return true;});
  var crumbs='';
  if(sel.subj) crumbs+='<span class="crumb">'+esc(sel.subj)+'</span>';
  if(sel.subj&&sel.g) crumbs+='<span class="sep">›</span>';
  if(sel.g) crumbs+='<span class="gtag" style="background:'+gvar(sel.g)+'">'+sel.g+'</span>';
  bc.innerHTML=crumbs+' <span class="hint">'+rs.length+' test'+(rs.length===1?'':'s')+'</span>';
  if(!rs.length){body.innerHTML='<div class="empty-msg">No tests here.</div>';return;}
  var groupKey = sel.subj&&sel.g ? function(r){return r.trigger||'—'} : sel.subj ? function(r){return r.guarantee} : function(r){return r.subject};
  var grp={};rs.forEach(function(r){var k=groupKey(r);(grp[k]=grp[k]||[]).push(r);});
  var keys=Object.keys(grp);
  if(sel.subj&&!sel.g) keys.sort(function(a,b){return G.indexOf(a)-G.indexOf(b)});
  else if(!sel.subj) keys.sort(subjOrder);
  var h='';
  keys.forEach(function(k){
    var rows=grp[k];
    var dot=(sel.subj&&!sel.g)?'<span class="adot" style="background:'+gvar(k)+'"></span>':'';
    h+='<div class="dgroup"><div class="dgh">'+dot+esc(k)+'<span class="tc">'+rows.length+'</span></div>';
    rows.sort(function(a,b){return a.asserts.localeCompare(b.asserts)});
    rows.forEach(function(r){h+=leafHTML(r,q)});
    h+='</div>';
  });
  body.innerHTML=h;
}
function renderAll(){renderMatrix();renderDrill();}

$('#q').addEventListener('input',renderAll);
$('#pills').addEventListener('click',function(e){var p=e.target.closest('.pill');if(!p)return;
  var t=p.dataset.t;if(types.has(t)){types.delete(t);p.removeAttribute('data-on');}else{types.add(t);p.setAttribute('data-on','');}renderAll();});
$('#authonly').addEventListener('click',function(){authOnly=!authOnly;if(authOnly)this.setAttribute('data-on','');else this.removeAttribute('data-on');renderAll();});
$('#failonly').addEventListener('click',function(){failOnly=!failOnly;if(failOnly)this.setAttribute('data-on','');else this.removeAttribute('data-on');renderAll();});
$('#mx').addEventListener('click',function(e){
  var cell=e.target.closest('.cell');if(cell&&!cell.classList.contains('empty')){sel={subj:cell.dataset.subj,g:cell.dataset.g};renderAll();return;}
  var rh=e.target.closest('.rh');if(rh){sel={subj:rh.dataset.subj};renderAll();return;}
  var hd=e.target.closest('.h');if(hd&&hd.dataset.g){sel={g:hd.dataset.g};renderAll();return;}
});
addEventListener('keydown',function(e){if(e.key==='/'&&document.activeElement!==$('#q')){e.preventDefault();$('#q').focus();}
  if(e.key==='Escape'){if($('#q').value){$('#q').value='';renderAll();}else{sel=null;renderAll();}$('#q').blur();}});
renderAll();
