"use strict";
/* ============================================================================
   app-views.js — view renderers + charts. Relies on globals from index.html:
   M, YEARS, VIEWS, $, $$, el, esc, fmt, pct, ordinal, highlight, slug, nav,
   toast, loadYear, loadScalingAll, ensureGlobalIndex, scaledFor, twinHTML,
   yearMeta, prefetchYear, computeSchoolYearCounts
   ============================================================================ */

/* ------------------------------------------------------------ small helpers */
function mctx(metric, year){
  const ys = M.manifest.years;
  const cur = ys.find(y=>y.y===year); if(!cur) return null;
  const val = cur[metric];
  const idx = ys.indexOf(cur);
  const prev = idx>0 ? ys[idx-1] : null;
  const delta = prev ? val - prev[metric] : null;
  const ranked = ys.slice().sort((a,b)=>b[metric]-a[metric]);
  const rank = ranked.indexOf(cur)+1;
  return { val, delta, prevYear: prev?prev.y:null, rank, total: ys.length };
}
function deltaHTML(metric, year, unit){
  const c = mctx(metric, year); if(!c || c.delta==null) return '';
  const up = c.delta>=0; const sign = up?'+':'';
  return `<span class="delta ${up?'up':'down'}">${sign}${fmt(c.delta)}${unit||''}</span> <span class="rankcap">vs ${c.prevYear} · #${c.rank} of ${c.total}</span>`;
}
function tile(label, value, meta, goldVal){
  return `<div class="tile"><div class="v${goldVal?' gold':''}">${value}</div><div class="l">${label}</div>${meta?`<div class="meta">${meta}</div>`:''}</div>`;
}
function backlink(text, hash){ return `<div class="backlink" data-h="${hash}">← ${esc(text)}</div>`; }
function wireLinks(root){
  $$('[data-h]', root).forEach(a=>{ if(a._w) return; a._w=1; a.addEventListener('click', e=>{ e.preventDefault(); e.stopPropagation(); nav(a.getAttribute('data-h')); }); });
}
function sparklineHTML(counts){ // counts = [11] for 40..50
  const max = Math.max(1, ...counts);
  return `<span class="spark" title="Distribution 40→50">`+counts.map((c,i)=>{ const sc=40+i; const h=Math.max(2,c/max*20); const cls=sc>=48?'b hot':sc>=45?'b warm':'b'; return `<span class="${cls}" style="height:${h}px" title="${sc}: ${c}"></span>`; }).join('')+`</span>`;
}
function histogramHTML(counts, total){ // counts=[11] 40..50
  const max = Math.max(1, ...counts); let rows='';
  for (let i=10;i>=0;i--){ const sc=40+i; const c=counts[i]; const w=c/max*100; const grad=sc>=48?'var(--bar-gold)':'var(--bar)'; const share= total?((c/total)*100).toFixed(1)+'%':''; rows+=`<div class="histogram"><span class="score">${sc}</span><div class="bar-wrap"><div class="bar" style="width:${w}%;background:${grad}"></div></div><span class="val">${fmt(c)} <small>${share}</small></span></div>`; }
  return rows;
}
function strengthBar(diff){ const cap=5; const p=Math.min(Math.abs(diff),cap)/cap*50; const sign=diff>=0?'pos':'neg'; const lbl=(diff>=0?'+':'')+diff.toFixed(1); return `<div class="strength" title="School avg vs state avg"><div class="track"><div class="fill ${sign}" style="width:${p}%"></div><div class="mid"></div></div><span class="v ${sign}">${lbl}</span></div>`; }
function scaleMix(stats){
  const segs = [ ['Scaled up', stats.scaledUp, 'var(--good)'], ['Sideways', stats.scaledSideways, 'var(--muted-2)'], ['Scaled down', stats.scaledDown, 'var(--warn)'], ['Not scaled', stats.notScaled, 'var(--panel-3)'] ].filter(s=>s[1]);
  const bar = segs.map(([l,v,c])=>`<div title="${l}: ${fmt(v.n)} (${v.pct}%)" style="width:${v.pct}%;background:${c}"></div>`).join('');
  const legend = segs.map(([l,v,c])=>`<span><i style="width:10px;height:10px;border-radius:3px;background:${c}"></i>${l} <b class="num">${v.pct}%</b></span>`).join('');
  return `<div style="display:flex;height:16px;border-radius:6px;overflow:hidden;border:1px solid var(--border)">${bar}</div><div class="chart-legend" style="margin-top:8px">${legend}</div>`;
}

/* ------------------------------------------------------------ SVG line chart */
function lineChart(series, opt){
  opt = opt||{};
  const W = opt.width||680, H = opt.height||220, pad = { l:44, r:14, t:12, b:26 };
  const xs = series[0].points.map(p=>p[0]);
  const xmin = Math.min(...xs), xmax = Math.max(...xs);
  let ymin = opt.yMin!=null?opt.yMin:Math.min(...series.flatMap(s=>s.points.map(p=>p[1])));
  let ymax = opt.yMax!=null?opt.yMax:Math.max(...series.flatMap(s=>s.points.map(p=>p[1])));
  if (ymin===ymax){ ymax+=1; ymin-=1; }
  const pdY=(ymax-ymin)*0.08; ymin-= (opt.yMin!=null?0:pdY); ymax+=(opt.yMax!=null?0:pdY);
  const X = x => pad.l + (xmax===xmin?0:(x-xmin)/(xmax-xmin))*(W-pad.l-pad.r);
  const Y = y => pad.t + (1-(y-ymin)/(ymax-ymin))*(H-pad.t-pad.b);
  const yticks = 4; let grid='', yaxis='';
  for (let i=0;i<=yticks;i++){ const v=ymin+(ymax-ymin)*i/yticks; const yy=Y(v); grid+=`<line x1="${pad.l}" y1="${yy}" x2="${W-pad.r}" y2="${yy}"/>`; yaxis+=`<text x="${pad.l-6}" y="${yy+3}" text-anchor="end">${opt.yFmt?opt.yFmt(v):Math.round(v)}</text>`; }
  let xaxis=''; const xstep=Math.ceil(xs.length/8);
  xs.forEach((x,i)=>{ if(i%xstep===0||i===xs.length-1){ xaxis+=`<text x="${X(x)}" y="${H-8}" text-anchor="middle">${opt.xFmt?opt.xFmt(x):x}</text>`; } });
  let lines='';
  for (const s of series){
    const dpath = s.points.map((p,i)=>(i?'L':'M')+X(p[0]).toFixed(1)+' '+Y(p[1]).toFixed(1)).join(' ');
    if (s.area){ const a=`M${X(s.points[0][0])} ${Y(ymin)} `+s.points.map(p=>'L'+X(p[0]).toFixed(1)+' '+Y(p[1]).toFixed(1)).join(' ')+` L${X(s.points[s.points.length-1][0])} ${Y(ymin)} Z`; lines+=`<path d="${a}" fill="${s.color}" opacity="0.10"/>`; }
    lines+=`<path d="${dpath}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
    if (opt.dots!==false && s.points.length<=30) lines += s.points.map(p=>`<circle cx="${X(p[0]).toFixed(1)}" cy="${Y(p[1]).toFixed(1)}" r="2.4" fill="${s.color}"/>`).join('');
    if (s.markYear!=null){ const p=s.points.find(pp=>pp[0]===s.markYear); if(p) lines+=`<circle cx="${X(p[0])}" cy="${Y(p[1])}" r="4.5" fill="none" stroke="${s.color}" stroke-width="2"/>`; }
  }
  return `<div class="chart"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img"><g class="grid">${grid}</g><g class="axis">${yaxis}${xaxis}</g>${lines}</svg></div>`;
}
function legendHTML(series){ return `<div class="chart-legend">`+series.map(s=>`<span><i style="background:${s.color}"></i>${esc(s.name)}</span>`).join('')+`</div>`; }

/* scaling curve: raw 40..50 -> scaled, with y=x reference */
function scalingCurve(scale, opt){
  opt=opt||{}; const W=opt.width||360, H=opt.height||300, pad={l:34,r:14,t:12,b:26};
  const raws=[]; for(let r=40;r<=50;r++) raws.push(r);
  const vals = scale;
  const lo = Math.min(40, ...vals), hi = Math.max(50, ...vals);
  const X = r => pad.l + (r-40)/10*(W-pad.l-pad.r);
  const Y = v => pad.t + (1-(v-lo)/(hi-lo))*(H-pad.t-pad.b);
  let grid='', yaxis='', xaxis='';
  for(let i=0;i<=4;i++){ const v=lo+(hi-lo)*i/4; const yy=Y(v); grid+=`<line x1="${pad.l}" y1="${yy}" x2="${W-pad.r}" y2="${yy}"/>`; yaxis+=`<text x="${pad.l-6}" y="${yy+3}" text-anchor="end">${v.toFixed(0)}</text>`; }
  for(const r of [40,42,44,46,48,50]) xaxis+=`<text x="${X(r)}" y="${H-8}" text-anchor="middle">${r}</text>`;
  const ref = `M${X(40)} ${Y(40)} L${X(50)} ${Y(50)}`;
  const line = raws.map((r,i)=>(i?'L':'M')+X(r).toFixed(1)+' '+Y(vals[i]).toFixed(1)).join(' ');
  const dots = raws.map((r,i)=>`<circle cx="${X(r).toFixed(1)}" cy="${Y(vals[i]).toFixed(1)}" r="2.6" fill="var(--accent)"><title>Raw ${r} → ${(+vals[i]).toFixed(1)}</title></circle>`).join('');
  return `<div class="chart"><svg viewBox="0 0 ${W} ${H}" role="img"><g class="grid">${grid}</g><g class="axis">${yaxis}${xaxis}</g><path d="${ref}" stroke="var(--muted-2)" stroke-width="1" stroke-dasharray="4 4" fill="none"/><path d="${line}" stroke="var(--accent)" stroke-width="2.4" fill="none" stroke-linejoin="round"/>${dots}<text x="${W-pad.r}" y="${Y(40)-4}" text-anchor="end" class="lbl">no scaling (y=x)</text></svg></div>`;
}

/* small sparkline (SVG) for stats small-multiples */
function miniSpark(values, markIdx, color){
  const W=120,H=30,pad=3; const lo=Math.min(...values), hi=Math.max(...values);
  const X=i=>pad+i/(values.length-1)*(W-2*pad); const Y=v=>pad+(1-(hi===lo?0.5:(v-lo)/(hi-lo)))*(H-2*pad);
  const d=values.map((v,i)=>(i?'L':'M')+X(i).toFixed(1)+' '+Y(v).toFixed(1)).join(' ');
  const mark = markIdx!=null?`<circle cx="${X(markIdx).toFixed(1)}" cy="${Y(values[markIdx]).toFixed(1)}" r="3" fill="${color||'var(--accent)'}"/>`:'';
  return `<svg viewBox="0 0 ${W} ${H}" style="width:${W}px;height:${H}px"><path d="${d}" fill="none" stroke="${color||'var(--accent)'}" stroke-width="1.5"/>${mark}</svg>`;
}

/* ============================================================ OVERVIEW */
function renderOverview(d, params){
  const y=d.year, st=d.stats, m=yearMeta(y);
  const topSchools = d.schools.slice().sort((a,b)=>b.total-a.total).slice(0,8);
  const standout = d.subjects.slice().sort((a,b)=>b.p-a.p).slice(0,8);
  const leaders = d.students.slice().sort((a,b)=>b.s-a.s||b.c-a.c).slice(0,8).map(s=>({s,i:d.students.indexOf(s)}));
  const app=$('#app');
  app.innerHTML = `
    <h1 class="page-title">${y} <span class="accent">overview</span></h1>
    <div class="page-sub">${fmt(st.totalStudents)} students earned ${fmt(st.totalScores)} scores of 40+ across ${fmt(st.totalSubjects)} subjects and ${fmt(st.totalSchools)} schools.</div>
    <div class="tiles">
      ${tile('Students', fmt(m.students), deltaHTML('students',y))}
      ${tile('Scores of 40+', fmt(m.scores), deltaHTML('scores',y))}
      ${tile('Perfect 50s', fmt(m.perfect), deltaHTML('perfect',y), true)}
      ${tile('Schools', fmt(m.schools), deltaHTML('schools',y))}
      ${tile('Subjects', fmt(m.subjects), deltaHTML('subjects',y))}
      ${tile('Scores above 50 (scaled)', fmt(st.above50), 'from scaling')}
    </div>
    <div class="two-col" style="margin-top:22px">
      <div class="card">
        <div class="section-title" style="margin-top:0">Score distribution · 40 → 50</div>
        ${histogramHTML(distArr(st), st.totalScores)}
        <div class="section-title">How scores scaled this year</div>
        ${scaleMix(st)}
      </div>
      <div class="card">
        <div class="section-title" style="margin-top:0">Leaderboards</div>
        <div class="mini-tabs-wrap"></div>
        <table class="mini-table"><thead><tr><th>Top schools · by 40+ scores</th><th class="n">40+</th><th class="n">50s</th></tr></thead><tbody>
          ${topSchools.map((s,i)=>`<tr class="link" data-h="#/y/${y}/school/${s.id}"><td>${i+1}. ${esc(s.name)}</td><td class="n">${fmt(s.total)}</td><td class="n">${s.perfect?`<span class="pill gold">${s.perfect}</span>`:'0'}</td></tr>`).join('')}
        </tbody></table>
        <table class="mini-table" style="margin-top:14px"><thead><tr><th>Standout subjects · by 50s</th><th class="n">50s</th><th class="n">avg</th></tr></thead><tbody>
          ${standout.map(s=>`<tr class="link" data-h="#/y/${y}/subject/${s.id}"><td>${esc(s.name)}</td><td class="n"><span class="pill gold">${s.p}</span></td><td class="n">${s.avg.toFixed(1)}</td></tr>`).join('')}
        </tbody></table>
        <table class="mini-table" style="margin-top:14px"><thead><tr><th>Cohort leaders · by total</th><th class="n">40+</th><th class="n">Sum</th></tr></thead><tbody>
          ${leaders.map(({s,i})=>`<tr class="link" data-h="#/y/${y}/student/${i}"><td>${nameCell(s.n)}<div class="muted" style="font-size:11px">${esc(d.schools[s.sc].name)}</div></td><td class="n">${s.c}</td><td class="n">${s.s}</td></tr>`).join('')}
        </tbody></table>
      </div>
    </div>`;
  wireLinks(app); wireRowLinks(app);
}
function distArr(st){ const a=[]; for(let sc=40;sc<=50;sc++) a.push(st.dist[sc]||0); return a; }
function nameCell(n){ const i=n.indexOf(', '); return i<0?esc(n):`<span class="sur">${esc(n.slice(0,i))}</span>${esc(n.slice(i))}`; }
function wireRowLinks(root){ $$('tr.link[data-h]', root).forEach(tr=>{ if(tr._w)return; tr._w=1; tr.addEventListener('click',()=>nav(tr.getAttribute('data-h'))); }); }

/* ============================================================ STUDENTS */
function renderStudents(d, params){
  const y=d.year;
  const state = {
    q: params.get('q')||'', subj: params.get('subj')!=null?+params.get('subj'):null,
    min: +(params.get('min')||0), fifty: params.get('fifty')==='1',
    sort: params.get('sort')||'sum', page: +(params.get('page')||0), school: params.get('school')!=null?+params.get('school'):null,
  };
  const subjOpts = d.subjects.slice().sort((a,b)=>a.name.localeCompare(b.name));
  const app=$('#app');
  app.innerHTML = `
    <h1 class="page-title">${y} <span class="accent">students</span></h1>
    <div class="page-sub">Every student with a published score of 40+ in ${y}. Click any row for their full profile with scaled scores.</div>
    <div class="active-filters" id="stu-filters"></div>
    <div class="toolbar">
      <input type="search" id="stu-q" placeholder="Filter by name or school…" style="min-width:220px" value="${esc(state.q)}"/>
      <select id="stu-subj"><option value="">Any subject</option>${subjOpts.map(s=>`<option value="${s.id}"${state.subj===s.id?' selected':''}>${esc(s.name)}</option>`).join('')}</select>
      <div class="chipset">
        <button class="fchip" data-min="3">3+</button><button class="fchip" data-min="4">4+</button><button class="fchip" data-min="5">5+</button>
        <button class="fchip" data-fifty>Has a 50</button>
      </div>
      <select id="stu-sort">
        <option value="sum">Highest total</option><option value="count">Most 40+ scores</option><option value="max">Top single score</option><option value="name">Name A–Z</option>
      </select>
      <span class="count" id="stu-count"></span>
    </div>
    <div class="panel"><table id="stu-table"><thead><tr><th class="rankcell">#</th><th>Student</th><th>School</th><th class="n">40+</th><th class="n">Sum</th><th class="n">Top</th></tr></thead><tbody></tbody></table><div class="empty hide" id="stu-empty">No students match.</div></div>
    <div class="pagination" id="stu-pag"></div>`;
  const q=$('#stu-q'), subj=$('#stu-subj'), sort=$('#stu-sort');
  sort.value=state.sort;
  const paintChips=()=>{ $$('.fchip[data-min]').forEach(b=>b.classList.toggle('on', state.min===+b.dataset.min)); $('.fchip[data-fifty]').classList.toggle('on', state.fifty); };
  paintChips();
  const PAGE=200;
  function refresh(updateUrl){
    let list = d.students.map((s,i)=>({s,i}));
    if (state.school!=null) list=list.filter(x=>x.s.sc===state.school);
    if (state.min>0) list=list.filter(x=>x.s.c>=state.min);
    if (state.fifty) list=list.filter(x=>x.s.sj.some(z=>z[1]>=50));
    if (state.subj!=null) list=list.filter(x=>x.s.sj.some(z=>z[0]===state.subj));
    const ql=state.q.toLowerCase().trim();
    if (ql) list=list.filter(x=> x.s.n.toLowerCase().includes(ql) || d.schools[x.s.sc].name.toLowerCase().includes(ql));
    const so=state.sort;
    list.sort((a,b)=>{ if(so==='name')return a.s.n.localeCompare(b.s.n); if(so==='count')return b.s.c-a.s.c||b.s.s-a.s.s; if(so==='max'){const am=Math.max(...a.s.sj.map(z=>z[1])),bm=Math.max(...b.s.sj.map(z=>z[1])); return bm-am||b.s.s-a.s.s;} return b.s.s-a.s.s||b.s.c-a.s.c; });
    const total=list.length; const pages=Math.max(1,Math.ceil(total/PAGE));
    if(state.page>=pages) state.page=0;
    const slice=list.slice(state.page*PAGE,(state.page+1)*PAGE);
    $('#stu-count').textContent = fmt(total)+' student'+(total===1?'':'s');
    const tb=$('#stu-table tbody');
    if(!slice.length){ tb.innerHTML=''; $('#stu-empty').classList.remove('hide'); $('#stu-pag').innerHTML=''; }
    else { $('#stu-empty').classList.add('hide');
      tb.innerHTML = slice.map(({s,i},k)=>{ const top=Math.max(...s.sj.map(z=>z[1])); const rank=state.page*PAGE+k+1; return `<tr class="link" data-h="#/y/${y}/student/${i}"><td class="rankcell">${rank}</td><td>${highlightName(s.n,ql)}</td><td class="muted">${highlight(d.schools[s.sc].name,ql)}</td><td class="n">${s.c}</td><td class="n">${s.s}</td><td class="n">${top>=50?`<span class="pill gold">${top}</span>`:`<span class="pill">${top}</span>`}</td></tr>`; }).join('');
      wireRowLinks(tb);
      $('#stu-pag').innerHTML = pages>1?`<button id="pp" ${state.page===0?'disabled':''}>← Prev</button><span>Page ${state.page+1} of ${fmt(pages)}</span><button id="pn" ${state.page===pages-1?'disabled':''}>Next →</button>`:'';
      const pp=$('#pp'),pn=$('#pn'); if(pp)pp.onclick=()=>{state.page--;refresh(true);scrollTop();}; if(pn)pn.onclick=()=>{state.page++;refresh(true);scrollTop();};
    }
    renderStuFilters();
    if(updateUrl) syncUrl();
  }
  function renderStuFilters(){
    const wrap=$('#stu-filters'); const chips=[];
    if(state.school!=null && d.schools[state.school]) chips.push(`<span class="filter-chip">School: ${esc(d.schools[state.school].name)} <button class="x" data-clr="school">×</button></span>`);
    if(state.subj!=null && d.subjects[state.subj]) chips.push(`<span class="filter-chip">Subject: ${esc(d.subjects[state.subj].name)} <button class="x" data-clr="subj">×</button></span>`);
    wrap.innerHTML=chips.join('');
    $$('#stu-filters .x').forEach(x=>x.onclick=()=>{ if(x.dataset.clr==='school')state.school=null; if(x.dataset.clr==='subj'){state.subj=null;$('#stu-subj').value='';} state.page=0; refresh(true); });
  }
  function syncUrl(){ const p=new URLSearchParams(); if(state.q)p.set('q',state.q); if(state.subj!=null)p.set('subj',state.subj); if(state.min)p.set('min',state.min); if(state.fifty)p.set('fifty','1'); if(state.sort!=='sum')p.set('sort',state.sort); if(state.school!=null)p.set('school',state.school); if(state.page)p.set('page',state.page); const qs=p.toString(); history.replaceState(null,'', '#/y/'+y+'/students'+(qs?'?'+qs:'')); }
  let ql=state.q.toLowerCase().trim();
  q.addEventListener('input', debounce(()=>{ state.q=q.value; ql=state.q.toLowerCase().trim(); state.page=0; refresh(true); },140));
  subj.addEventListener('change',()=>{ state.subj=subj.value?+subj.value:null; state.page=0; refresh(true); });
  sort.addEventListener('change',()=>{ state.sort=sort.value; state.page=0; refresh(true); });
  $$('.fchip[data-min]').forEach(b=>b.onclick=()=>{ state.min=state.min===+b.dataset.min?0:+b.dataset.min; state.page=0; paintChips(); refresh(true); });
  $('.fchip[data-fifty]').onclick=()=>{ state.fifty=!state.fifty; state.page=0; paintChips(); refresh(true); };
  refresh(false);
}
function highlightName(n,q){ const i=n.indexOf(', '); if(i<0)return highlight(n,q); return `<span class="sur">${highlight(n.slice(0,i),q)}</span>${highlight(n.slice(i),q)}`; }
function scrollTop(){ window.scrollTo({top:0,behavior:'smooth'}); }

/* ============================================================ STUDENT DETAIL */
function renderStudentDetail(d, id){
  const st=d.students[id]; const app=$('#app');
  if(!st){ app.innerHTML='<div class="empty">Student not found.</div>'; return; }
  const y=d.year; const school=d.schools[st.sc]; const m=yearMeta(y);
  const top=Math.max(...st.sj.map(z=>z[1])); const fifties=st.sj.filter(z=>z[1]>=50).length;
  const subs = st.sj.slice().sort((a,b)=>b[1]-a[1]);
  const subjRows = subs.map(([sjid,sc])=>{ const sj=d.subjects[sjid]; const scaled=scaledFor(d,sjid,sc); return `<tr class="link" data-h="#/y/${y}/subject/${sjid}"><td>${esc(sj.name)}</td><td>${twinHTML(sc,scaled)}</td><td class="n muted">${sj.avg.toFixed(1)}</td><td class="n"><span class="pill${sj.p?' gold':''}">${sj.p} @50</span></td></tr>`; }).join('');
  const sumRank = d.students.filter(x=>x.s>st.s).length+1;
  app.innerHTML = `
    ${backlink('Back to '+y+' students', '#/y/'+y+'/students')}
    <div class="entity-head"><h1>${nameCell(st.n)}</h1>
      <div class="rank-pills"><span class="pill accent">Class of ${y}</span>${fifties?`<span class="pill gold">${fifties}×50</span>`:''}<span class="pill">#${sumRank} in ${y} by total</span></div>
    </div>
    <div class="page-sub"><span class="linkish" data-h="#/school/${slug(school.name)}">${esc(school.name)}</span> · <span class="linkish" data-h="#/y/${y}/school/${st.sc}">see school in ${y} →</span></div>
    <div class="detail-grid">
      <div>
        <div class="tiles" style="grid-template-columns:1fr 1fr">
          ${tile('Scores of 40+', st.c)}
          ${tile('Total (sum of raw)', st.s, `year's best is ${m.maxSum}`)}
          ${tile('Perfect 50s', fifties, '', true)}
          ${tile('Top single score', top, '', top>=50)}
        </div>
        <div class="section-title">Their scores, raw → scaled</div>
        <div class="card" style="padding:12px 14px"><div class="subj-chips">${subs.map(([sjid,sc])=>`<span class="chip-sm${sc>=50?' perfect':''}"><span class="lk" data-h="#/y/${y}/subject/${sjid}">${esc(d.subjects[sjid].name)}</span> <b>${sc}</b></span>`).join('')}</div></div>
      </div>
      <div>
        <div class="section-title" style="margin-top:0">Subject breakdown</div>
        <div class="panel"><table class="mini-table"><thead><tr><th>Subject</th><th>Raw → scaled</th><th class="n">State avg</th><th class="n">50s in subject</th></tr></thead><tbody>${subjRows}</tbody></table></div>
        <div style="margin-top:14px" class="chart-legend"><span class="muted">Scaled scores use ${y} VCAA scaling for each subject. “50s in subject” is the statewide count of perfect scores.</span></div>
        <div style="margin-top:14px"><button class="btn" id="copy-link">🔗 Copy link to this profile</button> <button class="btn" data-h="#/y/${y}/school/${st.sc}">Others at ${esc(shortName(school.name))} →</button></div>
      </div>
    </div>`;
  wireLinks(app); wireRowLinks(app);
  $('#copy-link').onclick=()=>{ navigator.clipboard?.writeText(location.href); toast('Link copied'); };
}
function shortName(n){ return n.length>26?n.slice(0,24)+'…':n; }

/* ============================================================ SCHOOLS */
function renderSchools(d, params){
  const y=d.year; const stateTotal=d.schools.reduce((a,s)=>a+s.total,0);
  const state={ q:params.get('q')||'', sort:params.get('sort')||'perfect', min:+(params.get('min')||0), lens: params.get('lens')!=null?+params.get('lens'):null };
  const subjOpts=d.subjects.slice().sort((a,b)=>a.name.localeCompare(b.name));
  const app=$('#app');
  app.innerHTML=`
    <h1 class="page-title">${y} <span class="accent">schools</span></h1>
    <div class="page-sub">${fmt(d.schools.length)} schools with at least one published 40+ score. Add a subject lens to rank schools within a subject.</div>
    <div class="toolbar">
      <input type="search" id="sch-q" placeholder="Search schools…" style="min-width:220px" value="${esc(state.q)}"/>
      <select id="sch-lens"><option value="">No subject lens</option>${subjOpts.map(s=>`<option value="${s.id}"${state.lens===s.id?' selected':''}>${esc(s.name)}</option>`).join('')}</select>
      <select id="sch-sort"></select>
      <select id="sch-min"><option value="0">All schools</option><option value="5">≥5 students</option><option value="10">≥10 students</option><option value="25">≥25 students</option><option value="50">≥50 students</option></select>
      <span class="count" id="sch-count"></span>
    </div>
    <div class="panel"><table id="sch-table"><thead id="sch-head"></thead><tbody></tbody></table><div class="empty hide" id="sch-empty">No schools match.</div></div>`;
  const q=$('#sch-q'),lens=$('#sch-lens'),sortSel=$('#sch-sort'),minSel=$('#sch-min');
  minSel.value=state.min;
  const SORT_DEF=[['perfect','Most 50s'],['total','Most 40+'],['students','Most students'],['rate','50s as % of 40+'],['avg','Avg total / student'],['name','A–Z']];
  const SORT_LENS=[['lp','Most 50s in subject'],['ln','Most 40+ in subject'],['lavg','Highest avg in subject'],['lr','Best rank in subject'],['name','A–Z']];
  function buildSort(){ const opts=state.lens!=null?SORT_LENS:SORT_DEF; if(!opts.some(o=>o[0]===state.sort)) state.sort=opts[0][0]; sortSel.innerHTML=opts.map(([v,l])=>`<option value="${v}"${v===state.sort?' selected':''}>Sort: ${l}</option>`).join(''); }
  function lensEntry(s){ return s.subs.find(x=>x.sj===state.lens); }
  function buildHead(){ let cols; if(state.lens!=null){ cols=['#','School','40+','50s','Avg','vs State','Rank']; } else { cols=['#','School','40+','50s','Students','50 rate','Avg total']; } $('#sch-head').innerHTML='<tr>'+cols.map((c,i)=>`<th class="${i===0?'rankcell':i>=2?'n':''}">${c}</th>`).join('')+'</tr>'; }
  function refresh(updateUrl){
    buildSort(); buildHead();
    const ql=state.q.toLowerCase().trim();
    let list=d.schools.slice();
    if(ql)list=list.filter(s=>s.name.toLowerCase().includes(ql));
    if(state.min>0)list=list.filter(s=>s.students>=state.min);
    if(state.lens!=null)list=list.filter(s=>lensEntry(s));
    const stateAvg=state.lens!=null?d.subjects[state.lens].avg:0;
    const so=state.sort;
    list.sort((a,b)=>{ if(so==='name')return a.name.localeCompare(b.name);
      if(state.lens!=null){ const ea=lensEntry(a),eb=lensEntry(b); if(so==='ln')return eb.n-ea.n||eb.p-ea.p; if(so==='lavg')return eb.avg-ea.avg||eb.p-ea.p; if(so==='lr')return ea.r-eb.r; return eb.p-ea.p||eb.n-ea.n||eb.avg-ea.avg; }
      if(so==='rate')return (b.perfect/Math.max(b.total,1))-(a.perfect/Math.max(a.total,1)); if(so==='students')return b.students-a.students; if(so==='total')return b.total-a.total; if(so==='avg')return b.avg-a.avg; return b.perfect-a.perfect||b.total-a.total; });
    $('#sch-count').textContent=fmt(list.length)+' school'+(list.length===1?'':'s');
    const tb=$('#sch-table tbody');
    if(!list.length){ tb.innerHTML=''; $('#sch-empty').classList.remove('hide'); }
    else { $('#sch-empty').classList.add('hide');
      tb.innerHTML=list.map((s,i)=>{ const rc=i<3?`rankcell rank-${i+1}`:'rankcell';
        if(state.lens!=null){ const e=lensEntry(s); const diff=e.avg-stateAvg; return `<tr class="link" data-h="#/y/${y}/school/${s.id}"><td class="${rc}">${i+1}</td><td>${highlight(s.name,ql)}</td><td class="n">${e.n}</td><td class="n">${e.p?`<span class="pill gold">${e.p}</span>`:'0'}</td><td class="n">${e.avg.toFixed(1)}</td><td>${strengthBar(diff)}</td><td class="n"><span class="pill${e.r===1?' gold':e.r<=3?' good':''}">${e.r}/${d.subjects[state.lens].ns}</span></td></tr>`; }
        const rate=pct(s.perfect,s.total).toFixed(1); return `<tr class="link" data-h="#/y/${y}/school/${s.id}"><td class="${rc}">${i+1}</td><td><div style="display:flex;align-items:center;gap:8px"><span>${highlight(s.name,ql)}</span>${sparklineHTML(s.counts)}</div></td><td class="n">${fmt(s.total)}</td><td class="n">${s.perfect?`<span class="pill gold">${s.perfect}</span>`:'0'}</td><td class="n">${s.students}</td><td class="n">${rate}%</td><td class="n">${s.avg||'–'}</td></tr>`; }).join('');
      wireRowLinks(tb);
    }
    if(updateUrl){ const p=new URLSearchParams(); if(state.q)p.set('q',state.q); if(state.lens!=null)p.set('lens',state.lens); if(state.sort!=='perfect')p.set('sort',state.sort); if(state.min)p.set('min',state.min); const qs=p.toString(); history.replaceState(null,'','#/y/'+y+'/schools'+(qs?'?'+qs:'')); }
  }
  q.addEventListener('input',debounce(()=>{state.q=q.value;refresh(true);},140));
  lens.addEventListener('change',()=>{ state.lens=lens.value?+lens.value:null; state.sort=state.lens!=null?'lp':'perfect'; refresh(true); });
  sortSel.addEventListener('change',()=>{state.sort=sortSel.value;refresh(true);});
  minSel.addEventListener('change',()=>{state.min=+minSel.value;refresh(true);});
  refresh(false);
}

/* ============================================================ SCHOOL DETAIL */
function renderSchoolDetail(d, id){
  const s=d.schools[id]; const app=$('#app');
  if(!s){ app.innerHTML='<div class="empty">School not found.</div>'; return; }
  const y=d.year; const total=d.schools.length; const stateTotal=d.schools.reduce((a,x)=>a+x.total,0);
  const rate=pct(s.perfect,s.total).toFixed(1); const share=pct(s.total,stateTotal).toFixed(2);
  const top1=s.subs.filter(x=>x.r===1).length, top5=s.subs.filter(x=>x.r<=5).length;
  const rankPill=(r,l)=>`<span class="pill ${r===1?'gold':r<=3?'good':r<=10?'accent':''}" title="${l}: rank ${r} of ${total}">${l} #${r}</span>`;
  const subjRows=s.subs.map(x=>{ const sj=d.subjects[x.sj]; const diff=x.avg-sj.avg; return `<tr class="link" data-h="#/y/${y}/subject/${x.sj}"><td>${esc(sj.name)}</td><td class="n">${x.n}</td><td class="n">${x.p?`<span class="pill gold">${x.p}</span>`:'0'}</td><td class="n">${x.top}</td><td class="n">${x.avg.toFixed(1)}</td><td class="n muted">${sj.avg.toFixed(1)}</td><td>${strengthBar(diff)}</td><td class="n"><span class="pill ${x.r===1?'gold':x.r<=3?'good':x.r<=10?'accent':''}">${x.r}/${sj.ns}</span></td></tr>`; }).join('');
  const topStudents=s.top.slice(0,12).map(idx=>{ const stu=d.students[idx]; const top=Math.max(...stu.sj.map(z=>z[1])); const chips=stu.sj.slice().sort((a,b)=>b[1]-a[1]).map(([sjid,sc])=>`<span class="chip-sm${sc>=50?' perfect':''}">${esc(d.subjects[sjid].name)} <b>${sc}</b></span>`).join(''); return `<tr class="link" data-h="#/y/${y}/student/${idx}"><td>${nameCell(stu.n)}<div class="subj-chips" style="margin-top:4px">${chips}</div></td><td class="n">${stu.c}</td><td class="n">${stu.s}</td><td class="n">${top>=50?`<span class="pill gold">${top}</span>`:top}</td></tr>`; }).join('');
  app.innerHTML=`
    ${backlink('Back to '+y+' schools','#/y/'+y+'/schools')}
    <div class="entity-head"><h1>${esc(s.name)}</h1><div class="rank-pills">${rankPill(s.ranks.perfect,'50s')} ${rankPill(s.ranks.total,'40+')} ${rankPill(s.ranks.students,'Students')} ${rankPill(s.ranks.rate,'50 rate')} ${rankPill(s.ranks.avg,'Avg total')}</div></div>
    <div class="page-sub">${y} · <span class="linkish" data-h="#/school/${slug(s.name)}">view this school across all years →</span></div>
    <div class="detail-grid">
      <div>
        <div class="tiles" style="grid-template-columns:1fr 1fr">
          ${tile('Scores of 40+', fmt(s.total), share+'% of state')}
          ${tile('Perfect 50s', s.perfect, rate+'% of its 40+', true)}
          ${tile('Students', s.students, 'avg total '+(s.avg||'–'))}
          ${tile('Subjects', s.subs.length, top1+' ranked #1 · '+top5+' top-5')}
        </div>
        <div class="section-title">Score distribution · 40 → 50</div>
        ${histogramHTML(s.counts, s.total)}
        <div style="margin-top:14px"><button class="btn" data-h="#/y/${y}/students?school=${id}">View all ${s.students} students →</button></div>
      </div>
      <div>
        <div class="section-title" style="margin-top:0">Subject strengths · statewide rank</div>
        <div class="panel"><table class="mini-table"><thead><tr><th>Subject</th><th class="n">40+</th><th class="n">50s</th><th class="n">Top</th><th class="n">Avg</th><th class="n">State</th><th>vs State</th><th class="n">Rank</th></tr></thead><tbody>${subjRows||'<tr><td colspan="8" class="muted">No subjects.</td></tr>'}</tbody></table></div>
        <div class="section-title">Top students</div>
        <div class="panel"><table class="mini-table"><thead><tr><th>Student & subjects</th><th class="n">40+</th><th class="n">Sum</th><th class="n">Top</th></tr></thead><tbody>${topStudents}</tbody></table></div>
      </div>
    </div>`;
  wireLinks(app); wireRowLinks(app);
}

/* ============================================================ SUBJECTS */
function renderSubjects(d, params){
  const y=d.year;
  const state={ q:params.get('q')||'', sort:params.get('sort')||'p' };
  const app=$('#app');
  app.innerHTML=`
    <h1 class="page-title">${y} <span class="accent">subjects</span></h1>
    <div class="page-sub">${fmt(d.subjects.length)} subjects with 40+ scores in ${y}. Scaled columns show how a raw 40 and a raw 50 convert under ${y} VCAA scaling.</div>
    <div class="toolbar">
      <input type="search" id="sub-q" placeholder="Search subjects…" style="min-width:220px" value="${esc(state.q)}"/>
      <select id="sub-sort">
        <option value="p">Most 50s</option><option value="n">Most 40+</option><option value="avg">Highest raw avg</option><option value="up">Scales up most (@50)</option><option value="down">Scales down most (@40)</option><option value="name">A–Z</option>
      </select>
      <span class="count" id="sub-count"></span>
    </div>
    <div class="panel"><table id="sub-table"><thead><tr><th class="rankcell">#</th><th class="sortable">Subject</th><th class="n">40+</th><th class="n">50s</th><th class="n">Raw avg</th><th class="n">Raw 40 →</th><th class="n">Raw 50 →</th><th class="n">Schools</th></tr></thead><tbody></tbody></table><div class="empty hide" id="sub-empty">No subjects match.</div></div>`;
  const q=$('#sub-q'),sortSel=$('#sub-sort'); sortSel.value=state.sort;
  function refresh(updateUrl){
    const ql=state.q.toLowerCase().trim();
    let list=d.subjects.slice(); if(ql)list=list.filter(s=>s.name.toLowerCase().includes(ql));
    const so=state.sort;
    list.sort((a,b)=>{ if(so==='name')return a.name.localeCompare(b.name); if(so==='n')return b.n-a.n; if(so==='avg')return b.avg-a.avg;
      if(so==='up'){ const av=a.scale?a.scale[10]:0, bv=b.scale?b.scale[10]:0; return bv-av; }
      if(so==='down'){ const av=a.scale?a.scale[0]:99, bv=b.scale?b.scale[0]:99; return av-bv; }
      return b.p-a.p||b.n-a.n; });
    $('#sub-count').textContent=fmt(list.length)+' subject'+(list.length===1?'':'s');
    const tb=$('#sub-table tbody');
    if(!list.length){ tb.innerHTML=''; $('#sub-empty').classList.remove('hide'); return; }
    $('#sub-empty').classList.add('hide');
    tb.innerHTML=list.map((s,i)=>{ const at40=s.scale?s.scale[0]:null, at50=s.scale?s.scale[10]:null; const up40=at40!=null?(at40-40):0; const up50=at50!=null?(at50-50):0;
      const c40=at40==null?'':(up40>0.05?'style="color:var(--good)"':up40<-0.05?'style="color:var(--warn)"':''); const c50=at50==null?'':(up50>0.05?'style="color:var(--good)"':'');
      return `<tr class="link" data-h="#/y/${y}/subject/${s.id}"><td class="rankcell">${i+1}</td><td>${highlight(s.name,ql)}</td><td class="n">${fmt(s.n)}</td><td class="n">${s.p?`<span class="pill gold">${s.p}</span>`:'0'}</td><td class="n">${s.avg.toFixed(1)}</td><td class="n" ${c40}>${at40!=null?at40.toFixed(1):'–'}</td><td class="n" ${c50}>${at50!=null?at50.toFixed(1):'–'}</td><td class="n muted">${s.ns}</td></tr>`; }).join('');
    wireRowLinks(tb);
    if(updateUrl){ const p=new URLSearchParams(); if(state.q)p.set('q',state.q); if(state.sort!=='p')p.set('sort',state.sort); const qs=p.toString(); history.replaceState(null,'','#/y/'+y+'/subjects'+(qs?'?'+qs:'')); }
  }
  q.addEventListener('input',debounce(()=>{state.q=q.value;refresh(true);},140));
  sortSel.addEventListener('change',()=>{state.sort=sortSel.value;refresh(true);});
  refresh(false);
}

/* ============================================================ SUBJECT DETAIL */
function renderSubjectDetail(d, id){
  const sj=d.subjects[id]; const app=$('#app');
  if(!sj){ app.innerHTML='<div class="empty">Subject not found.</div>'; return; }
  const y=d.year;
  // roster: students with this subject, grouped by score
  const roster=[]; d.students.forEach((st,i)=>{ const e=st.sj.find(z=>z[0]===id); if(e) roster.push({i, sc:e[1], name:st.n, school:st.sc}); });
  roster.sort((a,b)=>b.sc-a.sc || a.name.localeCompare(b.name));
  const byScore={}; roster.forEach(r=>{ (byScore[r.sc]=byScore[r.sc]||[]).push(r); });
  // top schools in subject (by rank r)
  const schoolsIn=[]; d.schools.forEach(s=>{ const e=s.subs.find(x=>x.sj===id); if(e) schoolsIn.push({s,e}); });
  schoolsIn.sort((a,b)=>a.e.r-b.e.r);
  const scaleTable = sj.scale?`<table class="mini-table"><thead><tr>${[40,41,42,43,44,45,46,47,48,49,50].map(r=>`<th class="n">${r}</th>`).join('')}</tr></thead><tbody><tr>${sj.scale.map(v=>`<td class="n${v>50?'':''}" ${v>50?'style="color:var(--gold);font-weight:600"':''}>${(+v).toFixed(1)}</td>`).join('')}</tr></tbody></table>`:'<div class="muted">No scaling data for this subject/year.</div>';
  const scoreList = [50,49,48,47,46,45,44,43,42,41,40].filter(sc=>byScore[sc]).map(sc=>{
    const rs=byScore[sc]; const show=sc>=48?rs:rs.slice(0,0);
    return `<div style="margin:6px 0"><div style="display:flex;align-items:center;gap:8px;margin-bottom:4px"><span class="pill${sc>=50?' gold':''}">${sc}</span><span class="muted" style="font-size:12px">${rs.length} student${rs.length===1?'':'s'}</span></div>${sc>=48?`<div class="subj-chips">${rs.map(r=>`<span class="chip-sm"><span class="lk" data-h="#/y/${y}/student/${r.i}">${esc(r.name)}</span></span>`).join('')}</div>`:''}</div>`;
  }).join('');
  app.innerHTML=`
    ${backlink('Back to '+y+' subjects','#/y/'+y+'/subjects')}
    <div class="entity-head"><h1>${esc(sj.name)}</h1><div class="rank-pills"><span class="pill">${fmt(sj.n)} scores of 40+</span>${sj.p?`<span class="pill gold">${sj.p} perfect 50s</span>`:''}<span class="pill accent">${sj.ns} schools</span></div></div>
    <div class="page-sub">${y} · <span class="linkish" data-h="#/subject/${slug(sj.name)}">see how ${esc(sj.name)} scales across all years →</span></div>
    <div class="detail-grid">
      <div>
        <div class="tiles" style="grid-template-columns:1fr 1fr">
          ${tile('Scores of 40+', fmt(sj.n))}
          ${tile('Perfect 50s', sj.p, '', true)}
          ${tile('Raw average', sj.avg.toFixed(1))}
          ${tile('Raw 50 scales to', sj.scale?(+sj.scale[10]).toFixed(1):'–', sj.scale&&sj.scale[10]>50?'beats a perfect':'', sj.scale&&sj.scale[10]>50)}
        </div>
        <div class="section-title">Scaling curve · raw → scaled</div>
        <div class="card">${sj.scale?scalingCurve(sj.scale):'<div class="muted">No scaling data.</div>'}</div>
        <div class="section-title">Scaling row</div>
        <div class="panel" style="overflow-x:auto">${scaleTable}</div>
      </div>
      <div>
        <div class="section-title" style="margin-top:0">Strongest schools in ${esc(sj.name)}</div>
        <div class="panel"><table class="mini-table"><thead><tr><th class="rankcell">#</th><th>School</th><th class="n">40+</th><th class="n">50s</th><th class="n">Avg</th></tr></thead><tbody>${schoolsIn.slice(0,12).map(({s,e})=>`<tr class="link" data-h="#/y/${y}/school/${s.id}"><td class="rankcell">${e.r}</td><td>${esc(s.name)}</td><td class="n">${e.n}</td><td class="n">${e.p?`<span class="pill gold">${e.p}</span>`:'0'}</td><td class="n">${e.avg.toFixed(1)}</td></tr>`).join('')}</tbody></table></div>
        <div class="section-title">Who scored 48–50</div>
        <div class="card" style="padding:12px 14px">${scoreList||'<span class="muted">No students.</span>'}<div style="margin-top:10px"><button class="btn" data-h="#/y/${y}/students?subj=${id}">View all ${roster.length} students in this subject →</button></div></div>
      </div>
    </div>`;
  wireLinks(app); wireRowLinks(app);
}

/* ============================================================ SCALING (matrix + lens) */
function renderScaling(d, params){
  const y=d.year; const app=$('#app');
  const withScale=d.subjects.filter(s=>s.scale);
  let curSj = params.get('sj')!=null ? withScale.find(s=>slug(s.name)===params.get('sj') || String(s.id)===params.get('sj')) : withScale[0];
  if(!curSj) curSj=withScale[0];
  let curRaw = +(params.get('raw')||45); if(curRaw<40||curRaw>50) curRaw=45;
  let sort='up';
  app.innerHTML=`
    <h1 class="page-title">${y} <span class="accent">scaling</span></h1>
    <div class="page-sub">VCAA scales each subject's raw study score (40–50) to account for difficulty. Hard subjects scale <span style="color:var(--good)">up</span>; some past 50. Use the lens to convert a specific score.</div>
    <div class="card" style="margin-bottom:18px">
      <div class="section-title" style="margin-top:0">Scaling lens · convert a raw score</div>
      <div class="lens">
        <div>
          <select id="lens-sj" style="width:100%">${withScale.slice().sort((a,b)=>a.name.localeCompare(b.name)).map(s=>`<option value="${s.id}"${s.id===curSj.id?' selected':''}>${esc(s.name)}</option>`).join('')}</select>
          <div class="slider-row"><span class="muted" style="font-size:12px">Raw</span><input type="range" id="lens-raw" min="40" max="50" value="${curRaw}"/><span class="rawval" id="lens-rawval">${curRaw}</span></div>
          <div class="readout" id="lens-readout" style="margin-top:14px"></div>
        </div>
        <div id="lens-curve"></div>
      </div>
    </div>
    <div class="toolbar"><div class="section-title" style="margin:0">Full scaling table · ${withScale.length} subjects</div>
      <select id="mx-sort" style="margin-left:auto"><option value="up">Sort: scales up most (@50)</option><option value="down">Sort: scales down most (@40)</option><option value="name">Sort: A–Z</option></select></div>
    <div class="matrix-wrap"><table class="matrix" id="matrix"></table></div>
    <div class="chart-legend" style="margin-top:10px"><span><i style="width:12px;height:12px;background:rgba(92,210,143,.35);border-radius:3px"></i>scales up</span><span><i style="width:12px;height:12px;background:rgba(255,153,102,.35);border-radius:3px"></i>scales down</span><span><i style="width:12px;height:12px;border:1.5px solid var(--gold);border-radius:3px"></i>above 50</span></div>`;
  const sjSel=$('#lens-sj'), rawSlider=$('#lens-raw');
  function updateLens(pushUrl){
    const sc=curSj.scale[curRaw-40]; const delta=+(sc-curRaw).toFixed(2);
    const cls=delta>0.05?'up':delta<-0.05?'down':'flat'; const verdict=delta>0.05?'scaled UP':delta<-0.05?'scaled DOWN':'unchanged';
    $('#lens-rawval').textContent=curRaw;
    $('#lens-readout').innerHTML=`<div class="lbl">${esc(curSj.name)} · raw ${curRaw}</div><div class="big${sc>50?' gold':''}">${sc.toFixed(1)}</div><div class="delta ${cls}">${(delta>0?'+':'')+delta.toFixed(1)} · ${verdict}</div>${sc>50?'<div class="lbl" style="color:var(--gold);margin-top:4px">a raw '+curRaw+' beats a perfect 50 elsewhere</div>':''}`;
    $('#lens-curve').innerHTML=scalingCurve(curSj.scale,{width:360,height:220});
    if(pushUrl) history.replaceState(null,'','#/y/'+y+'/scaling?sj='+slug(curSj.name)+'&raw='+curRaw);
  }
  sjSel.addEventListener('change',()=>{ curSj=d.subjects[+sjSel.value]; updateLens(true); });
  rawSlider.addEventListener('input',()=>{ curRaw=+rawSlider.value; updateLens(true); });
  function buildMatrix(){
    let list=withScale.slice();
    if(sort==='up')list.sort((a,b)=>b.scale[10]-a.scale[10]); else if(sort==='down')list.sort((a,b)=>a.scale[0]-b.scale[0]); else list.sort((a,b)=>a.name.localeCompare(b.name));
    let head='<thead><tr><th class="subj sortable">Subject</th>'+[40,41,42,43,44,45,46,47,48,49,50].map(r=>`<th class="n">${r}</th>`).join('')+'</tr></thead>';
    let body='<tbody>'+list.map(s=>{ const cells=s.scale.map((v,i)=>{ const raw=40+i; const diff=v-raw; const over=v>50; let bg=''; if(diff>0.05){ bg=`background:rgba(92,210,143,${Math.min(.4,diff/12)})`; } else if(diff<-0.05){ bg=`background:rgba(255,153,102,${Math.min(.4,-diff/12)})`; } return `<td class="cell${over?' over':''}" style="${bg}">${(+v).toFixed(1)}</td>`; }).join(''); return `<tr><th class="subj" data-h="#/y/${y}/subject/${s.id}">${esc(s.name)}</th>${cells}</tr>`; }).join('')+'</tbody>';
    $('#matrix').innerHTML=head+body;
    $$('#matrix th.subj[data-h]').forEach(th=>th.onclick=()=>nav(th.getAttribute('data-h')));
  }
  $('#mx-sort').addEventListener('change',e=>{ sort=e.target.value; buildMatrix(); });
  updateLens(false); buildMatrix();
}

/* ============================================================ STATISTICS */
function renderStats(d){
  const y=d.year, st=d.stats, m=yearMeta(y); const app=$('#app');
  const ys=M.manifest.years; const idx=ys.findIndex(x=>x.y===y);
  const smallMult=(metric,label,color)=>{ const vals=ys.map(x=>x[metric]); return `<div class="card" style="padding:12px 14px"><div class="l muted" style="font-size:10.5px;text-transform:uppercase;letter-spacing:.06em">${label}</div><div style="display:flex;align-items:center;gap:10px;margin-top:4px"><div class="v num" style="font-size:18px;font-weight:650">${metric==='scaledUpPct'||metric==='scaledDownPct'?vals[idx]+'%':fmt(vals[idx])}</div>${miniSpark(vals,idx,color)}</div></div>`; };
  app.innerHTML=`
    <h1 class="page-title">${y} <span class="accent">statistics</span></h1>
    <div class="page-sub">Official ${y} figures as published by quppa.net. <span class="muted">Note: quppa's own statistics count 1–2 more students than its data tables in some years; the browsable tables here reflect the actual published rows.</span></div>
    <div class="tiles">
      ${tile('Total students', fmt(st.totalStudents), deltaHTML('students',y))}
      ${tile('Total 40+ scores', fmt(st.totalScores), deltaHTML('scores',y))}
      ${tile('Avg 40+ / student', st.avgPerStudent)}
      ${tile('Schools', fmt(st.totalSchools), deltaHTML('schools',y))}
      ${tile('Subjects', fmt(st.totalSubjects), deltaHTML('subjects',y))}
      ${tile('Scores above 50', fmt(st.above50), 'after scaling')}
    </div>
    <div class="two-col" style="margin-top:22px">
      <div class="card"><div class="section-title" style="margin-top:0">Raw score distribution · 40 → 50</div>${histogramHTML(distArr(st),st.totalScores)}</div>
      <div class="card"><div class="section-title" style="margin-top:0">Scaling behaviour</div>${scaleMix(st)}
        <div class="section-title">The archive in context</div>
        <div class="tiles" style="grid-template-columns:1fr 1fr">
          ${smallMult('perfect','Perfect 50s','var(--gold)')}
          ${smallMult('maxSum','Highest total','var(--accent)')}
          ${smallMult('scaledUpPct','% scaled up','var(--good)')}
          ${smallMult('scaledDownPct','% scaled down','var(--warn)')}
        </div>
      </div>
    </div>`;
  wireLinks(app);
}

/* ============================================================ TRENDS (all-time) */
function renderTrends(){
  const ys=M.manifest.years; const app=$('#app');
  const pts=(k)=>ys.map(y=>[y.y,y[k]]);
  const app_ = `
    <h1 class="page-title">All-time <span class="accent">trends</span></h1>
    <div class="page-sub">${M.manifest.totals.yearCount} years of VCE study-score data, ${M.manifest.totals.firstYear}–${M.manifest.totals.lastYear}. Click any year in the table to dive in. (No data was published for 1999.)</div>
    <div class="two-col">
      <div class="card"><div class="section-title" style="margin-top:0">Students & 40+ scores per year</div>
        ${legendHTML([{name:'Students',color:'var(--accent)'},{name:'40+ scores',color:'var(--good)'}])}
        ${lineChart([{name:'Students',color:'var(--accent)',points:pts('students'),area:true},{name:'Scores',color:'var(--good)',points:pts('scores')}],{yMin:0,yFmt:v=>Math.round(v/1000)+'k'})}
      </div>
      <div class="card"><div class="section-title" style="margin-top:0">Perfect 50s per year</div>
        ${lineChart([{name:'Perfect 50s',color:'var(--gold)',points:pts('perfect'),area:true}],{yMin:0})}
      </div>
      <div class="card"><div class="section-title" style="margin-top:0">Scaling: % of scores scaled up vs down</div>
        ${legendHTML([{name:'% scaled up',color:'var(--good)'},{name:'% scaled down',color:'var(--warn)'}])}
        ${lineChart([{name:'up',color:'var(--good)',points:pts('scaledUpPct')},{name:'down',color:'var(--warn)',points:pts('scaledDownPct')}],{yFmt:v=>v.toFixed(0)+'%'})}
      </div>
      <div class="card"><div class="section-title" style="margin-top:0">Highest single total each year</div>
        ${lineChart([{name:'Max total',color:'var(--accent)',points:pts('maxSum')}],{})}
      </div>
    </div>
    <div class="section-title">Year by year</div>
    <div class="panel"><table><thead><tr><th>Year</th><th class="n">Students</th><th class="n">40+ scores</th><th class="n">Perfect 50s</th><th class="n">Schools</th><th class="n">Subjects</th><th class="n">Scaled up</th></tr></thead><tbody>
      ${ys.slice().reverse().map(y=>`<tr class="link" data-h="#/y/${y.y}"><td class="strong">${y.y}</td><td class="n">${fmt(y.students)}</td><td class="n">${fmt(y.scores)}</td><td class="n"><span class="pill gold">${fmt(y.perfect)}</span></td><td class="n">${y.schools}</td><td class="n">${y.subjects}</td><td class="n muted">${y.scaledUpPct}%</td></tr>`).join('')}
    </tbody></table></div>`;
  app.innerHTML=app_;
  wireLinks(app); wireRowLinks(app);
}

/* ============================================================ CROSS-YEAR: SCHOOL */
async function renderSchoolCrossYear(slugStr){
  const app=$('#app'); app.innerHTML='<div class="view-loading"><span class="spinner"></span>Loading school history…</div>';
  await ensureGlobalIndex();
  const idx=M.GI.schools.findIndex(n=>slug(n)===slugStr);
  if(idx<0){ app.innerHTML=`<div class="empty">School “${esc(slugStr)}” not found.</div>`; return; }
  const name=M.GI.schools[idx];
  // aggregate per year from GI
  const rows=[];
  for(const yStr of Object.keys(M.GI.byYear)){ const b=M.GI.byYear[yStr]; let students=0,scores=0,fifties=0,maxSum=0; for(let i=0;i<b.sc.length;i++){ if(b.sc[i]===idx){ students++; scores+=b.c[i]; if(b.top[i]>=50)fifties++; if(b.s[i]>maxSum)maxSum=b.s[i]; } } if(students) rows.push({y:+yStr,students,scores,fifties,maxSum}); }
  rows.sort((a,b)=>a.y-b.y);
  if(!rows.length){ app.innerHTML=`<div class="empty">No records for ${esc(name)}.</div>`; return; }
  const totStu=rows.reduce((a,r)=>a+r.students,0), totFif=rows.reduce((a,r)=>a+r.fifties,0), totSco=rows.reduce((a,r)=>a+r.scores,0);
  const series=[{name:'Students',color:'var(--accent)',points:rows.map(r=>[r.y,r.students]),area:true}];
  const fifSeries=[{name:'Perfect 50s',color:'var(--gold)',points:rows.map(r=>[r.y,r.fifties])}];
  app.innerHTML=`
    ${backlink('Home','#/')}
    <div class="entity-head"><h1>${esc(name)}</h1><div class="rank-pills"><span class="pill accent">${rows.length} years</span><span class="pill">${fmt(totStu)} students all-time</span><span class="pill gold">${fmt(totFif)} perfect 50s</span></div></div>
    <div class="page-sub">This school across ${rows.length} years of the archive. Naming can vary year to year — see the note below.</div>
    <div class="two-col">
      <div class="card"><div class="section-title" style="margin-top:0">Students with 40+ scores per year</div>${lineChart(series,{yMin:0,width:640})}</div>
      <div class="card"><div class="section-title" style="margin-top:0">Perfect 50s per year</div>${lineChart(fifSeries,{yMin:0,width:640})}</div>
    </div>
    <div class="section-title">Year by year</div>
    <div class="panel"><table><thead><tr><th>Year</th><th class="n">Students (40+)</th><th class="n">40+ scores</th><th class="n">Perfect 50s</th><th class="n">Best total</th><th></th></tr></thead><tbody>
      ${rows.slice().reverse().map(r=>`<tr class="link" data-goto="${r.y}"><td class="strong">${r.y}</td><td class="n">${fmt(r.students)}</td><td class="n">${fmt(r.scores)}</td><td class="n">${r.fifties?`<span class="pill gold">${r.fifties}</span>`:'0'}</td><td class="n">${r.maxSum}</td><td class="n"><span class="muted">open ${r.y} →</span></td></tr>`).join('')}
    </tbody></table></div>
    <div class="page-sub" style="margin-top:12px"><span class="muted">Matched by exact school name. Schools occasionally appear under slightly different names across years (campus renames etc.), which may split their history.</span></div>`;
  wireLinks(app);
  $$('tr[data-goto]',app).forEach(tr=>tr.onclick=()=>gotoSchoolInYear(name, +tr.dataset.goto));
}
async function gotoSchoolInYear(name, year){
  const d=await loadYear(year); const s=d.schools.find(x=>x.name===name);
  if(s) nav('#/y/'+year+'/school/'+s.id); else nav('#/y/'+year+'/schools?q='+encodeURIComponent(name.split(' ').slice(0,2).join(' ')));
}

/* ============================================================ CROSS-YEAR: SUBJECT */
async function renderSubjectCrossYear(slugStr){
  const app=$('#app'); app.innerHTML='<div class="view-loading"><span class="spinner"></span>Loading subject history…</div>';
  await loadScalingAll();
  // find subject name
  let name=null; for(const [n] of M.subjectDict){ if(slug(n)===slugStr){ name=n; break; } }
  if(!name){ app.innerHTML=`<div class="empty">Subject “${esc(slugStr)}” not found.</div>`; return; }
  const rows=[]; for(const yStr of Object.keys(M.SCALING)){ const row=M.SCALING[yStr][name]; if(row) rows.push({y:+yStr, at40:row[0], at50:row[10], scale:row}); }
  rows.sort((a,b)=>a.y-b.y);
  if(!rows.length){ app.innerHTML=`<div class="empty">No scaling history for ${esc(name)}.</div>`; return; }
  const s50=[{name:'Scaled score of a raw 50',color:'var(--gold)',points:rows.map(r=>[r.y,r.at50])}];
  const s40=[{name:'Scaled score of a raw 40',color:'var(--accent)',points:rows.map(r=>[r.y,r.at40])}];
  const latest=rows[rows.length-1];
  app.innerHTML=`
    ${backlink('Home','#/')}
    <div class="entity-head"><h1>${esc(name)}</h1><div class="rank-pills"><span class="pill accent">${rows.length} years</span><span class="pill${latest.at50>50?' gold':''}">raw 50 → ${latest.at50.toFixed(1)} in ${latest.y}</span></div></div>
    <div class="page-sub">How ${esc(name)} has scaled over time. A subject "hardens" when its scaled scores rise.</div>
    <div class="two-col">
      <div class="card"><div class="section-title" style="margin-top:0">Scaled score of a raw 50, per year</div>${lineChart(s50,{width:640})}</div>
      <div class="card"><div class="section-title" style="margin-top:0">Scaled score of a raw 40, per year</div>${lineChart(s40,{width:640})}</div>
    </div>
    <div class="section-title">Year by year</div>
    <div class="panel"><table><thead><tr><th>Year</th><th class="n">Raw 40 →</th><th class="n">Raw 45 →</th><th class="n">Raw 50 →</th><th></th></tr></thead><tbody>
      ${rows.slice().reverse().map(r=>`<tr class="link" data-goto="${r.y}"><td class="strong">${r.y}</td><td class="n">${r.at40.toFixed(1)}</td><td class="n">${r.scale[5].toFixed(1)}</td><td class="n${r.at50>50?'':''}" ${r.at50>50?'style="color:var(--gold)"':''}>${r.at50.toFixed(1)}</td><td class="n"><span class="muted">open ${r.y} →</span></td></tr>`).join('')}
    </tbody></table></div>`;
  wireLinks(app);
  $$('tr[data-goto]',app).forEach(tr=>tr.onclick=()=>gotoSubjectInYear(name, +tr.dataset.goto));
}
async function gotoSubjectInYear(name, year){
  const d=await loadYear(year); const s=d.subjects.find(x=>x.name===name);
  if(s) nav('#/y/'+year+'/subject/'+s.id); else nav('#/y/'+year+'/subjects?q='+encodeURIComponent(name));
}
