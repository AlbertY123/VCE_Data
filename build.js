// Multi-year parser: reads cached raw HTML in raw/{year}/ and emits:
//   data/y{year}.json   - full per-year detail (students, schools, subjects+scaling, statistics)
//   data/manifest.json  - year list + aggregate stats for the landing/overview
//   data/students-all.json - compact cross-year student search index
//
// Faithful to quppa.net. Only scores >= 40 are published (raw study scores 40..50).
const fs = require('fs');
const path = require('path');

const RAW = path.join(__dirname, 'raw');
const OUT = path.join(__dirname, 'data');
fs.mkdirSync(OUT, { recursive: true });

const YEARS = fs.readdirSync(RAW)
  .filter(d => /^\d{4}$/.test(d) && fs.statSync(path.join(RAW, d)).isDirectory())
  .map(Number).sort((a, b) => a - b);

// ---------- parsers ----------
function parseStudents(html) {
  const students = [];
  // NAME  <span class="greytext">(SCHOOL — may contain balanced parens)</span> ; Sum ; subject list
  const liRegex = /<li>\s*<h2>([^<]+?)\s*<span class="greytext">\(([\s\S]*?)\)<\/span><\/h2>\s*<div>(\d+)\s+total\s+\(Sum:\s*(-?\d+)\)<\/div>\s*<ul>([\s\S]*?)<\/ul>\s*<\/li>/g;
  const subjRegex = /<li>([^<]+?):\s*(-?\d+)<\/li>/g;
  let m;
  while ((m = liRegex.exec(html)) !== null) {
    const subjects = [];
    let s;
    subjRegex.lastIndex = 0;
    while ((s = subjRegex.exec(m[5])) !== null) subjects.push([s[1].trim(), parseInt(s[2], 10)]);
    students.push({
      n: m[1].trim(),
      sc: m[2].trim(),
      c: parseInt(m[3], 10),
      s: parseInt(m[4], 10),
      sj: subjects,
    });
  }
  return students;
}

function parseSchools(html) {
  const schools = [];
  const re = /<li>([^<]+?)\s*<span class="greytext">\((\d+)\s+total\)<\/span>\s*<ul[^>]*>([\s\S]*?)<\/ul><\/li>/g;
  const itemRe = /<li>(\d+):\s*(\d+)<\/li>/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const counts = {};
    let i;
    itemRe.lastIndex = 0;
    while ((i = itemRe.exec(m[3])) !== null) counts[i[1]] = parseInt(i[2], 10);
    schools.push({ name: m[1].trim(), total: parseInt(m[2], 10), counts });
  }
  return schools;
}

function parseScaling(html) {
  // Map subjectName -> [11 values for raw 40..50] (floats; null if blank)
  const map = new Map();
  const rowRe = /<tr>\s*<th>([^<]+)<\/th>((?:\s*<td>[^<]*<\/td>){2,})\s*<\/tr>/g;
  const cellRe = /<td>([^<]*)<\/td>/g;
  let m;
  while ((m = rowRe.exec(html)) !== null) {
    const name = m[1].trim();
    const cells = [];
    let c;
    cellRe.lastIndex = 0;
    while ((c = cellRe.exec(m[2])) !== null) {
      const v = c[1].trim();
      cells.push(v === '' ? null : parseFloat(v));
    }
    if (cells.length >= 11) map.set(name, cells.slice(0, 11));
  }
  return map;
}

function parseStats(html) {
  const num = (re) => { const m = html.match(re); return m ? parseFloat(m[1].replace(/,/g, '')) : null; };
  const pair = (label) => {
    const m = html.match(new RegExp(label + ':\\s*([\\d,]+)\\s*\\((\\d+\\.?\\d*)%\\)'));
    return m ? { n: parseInt(m[1].replace(/,/g, ''), 10), pct: parseFloat(m[2]) } : null;
  };
  const dist = {};
  const distRe = /<li>(\d+):\s*(\d+)<\/li>/g;
  const distSection = (html.split('Total score counts')[1] || '');
  let d;
  while ((d = distRe.exec(distSection)) !== null) dist[d[1]] = parseInt(d[2], 10);
  return {
    totalStudents: num(/Total students:\s*([\d,]+)/),
    totalScores: num(/Total scores:\s*([\d,]+)/),
    avgPerStudent: num(/40\+ scores per student:\s*([\d.]+)/),
    totalSchools: num(/Total schools:\s*([\d,]+)/),
    avgPerSchool: num(/40\+ scores per school:\s*([\d.]+)/),
    totalSubjects: num(/Total subjects:\s*([\d,]+)/),
    avgPerSubject: num(/40\+ scores per subject:\s*([\d.]+)/),
    scaledUp: pair('Total scores scaled up'),
    scaledDown: pair('Total scores scaled down'),
    scaledSideways: pair('Total scores scaled sideways'),
    notScaled: pair('Total scores not scaled'),
    above50: num(/Total scores above 50:\s*([\d,]+)/),
    avgAbove50: num(/scores above 50 per student:\s*([\d.]+)/),
    dist,
  };
}

// ---------- per-year builder (cross-indexed, ranked) ----------
function buildYear(year) {
  const rd = (f) => fs.readFileSync(path.join(RAW, String(year), f), 'utf8');
  const students = parseStudents(rd('students.html'));
  const schoolsRaw = parseSchools(rd('schools.html'));
  const scaling = parseScaling(rd('scaling.html'));
  const stats = parseStats(rd('stats.html'));

  // School index (seed from schools page to preserve authoritative counts + order)
  const schoolIdByName = new Map();
  const schoolList = schoolsRaw.map((s, i) => {
    schoolIdByName.set(s.name, i);
    const counts = new Array(11).fill(0);
    for (let sc = 40; sc <= 50; sc++) counts[sc - 40] = s.counts[sc] || 0;
    return {
      id: i, name: s.name, total: s.total, counts,
      perfect: s.counts[50] || 0, students: 0, sumScore: 0, avg: 0,
      subjAgg: {}, subs: [], top: [],
    };
  });

  // Subject index
  const subjectIdByName = new Map();
  const subjectList = [];
  const subjectId = (name) => {
    if (subjectIdByName.has(name)) return subjectIdByName.get(name);
    const id = subjectList.length;
    subjectIdByName.set(name, id);
    subjectList.push({ id, name, n: 0, p: 0, sum: 0, avg: 0, ns: 0, scale: scaling.get(name) || null, _entries: [] });
    return id;
  };

  // Compact students with ids; accumulate school + subject aggregates
  const compact = students.map((st) => {
    let scid = schoolIdByName.get(st.sc);
    if (scid === undefined) {
      scid = schoolList.length;
      schoolIdByName.set(st.sc, scid);
      schoolList.push({ id: scid, name: st.sc, total: 0, counts: new Array(11).fill(0), perfect: 0, students: 0, sumScore: 0, avg: 0, subjAgg: {}, subs: [], top: [] });
    }
    const school = schoolList[scid];
    school.students++;
    school.sumScore += st.s;
    const sj = st.sj.map(([n, sc]) => {
      const sjid = subjectId(n);
      const sub = subjectList[sjid];
      sub.n++; sub.sum += sc;
      if (sc >= 50) sub.p++;
      let agg = school.subjAgg[sjid];
      if (!agg) agg = school.subjAgg[sjid] = { n: 0, p: 0, sum: 0, top: 0 };
      agg.n++; agg.sum += sc;
      if (sc >= 50) agg.p++;
      if (sc > agg.top) agg.top = sc;
      return [sjid, sc];
    });
    return { n: st.n, sc: scid, c: st.c, s: st.s, sj };
  });

  for (const school of schoolList) school.avg = school.students ? +(school.sumScore / school.students).toFixed(1) : 0;

  // Top students per school (by sum, then count)
  const bySchool = new Map();
  compact.forEach((st, i) => {
    if (!bySchool.has(st.sc)) bySchool.set(st.sc, []);
    bySchool.get(st.sc).push(i);
  });
  for (const [scid, ids] of bySchool) {
    ids.sort((a, b) => compact[b].s - compact[a].s || compact[b].c - compact[a].c);
    schoolList[scid].top = ids.slice(0, 25);
  }

  // Subject school-entries -> ranks
  for (const school of schoolList) {
    for (const sjidStr of Object.keys(school.subjAgg)) {
      const sjid = +sjidStr;
      const agg = school.subjAgg[sjid];
      subjectList[sjid]._entries.push({ scid: school.id, n: agg.n, p: agg.p, avg: agg.sum / agg.n, top: agg.top });
    }
  }
  for (const sub of subjectList) {
    sub._entries.sort((a, b) => b.p - a.p || b.n - a.n || b.avg - a.avg);
    sub.ns = sub._entries.length;
    sub.avg = sub.n ? +(sub.sum / sub.n).toFixed(2) : 0;
    sub._entries.forEach((entry, i) => {
      schoolList[entry.scid].subs.push({ sj: sub.id, n: entry.n, p: entry.p, top: entry.top, avg: +entry.avg.toFixed(2), r: i + 1 });
    });
    delete sub._entries;
  }
  for (const school of schoolList) {
    school.subs.sort((a, b) => a.r - b.r || b.n - a.n);
    delete school.subjAgg;
    delete school.sumScore;
  }

  // School-level ranks for badges
  const rankBy = (keyFn) => {
    const sorted = schoolList.slice().sort((a, b) => keyFn(b) - keyFn(a));
    const map = new Map();
    sorted.forEach((s, i) => map.set(s.id, i + 1));
    return map;
  };
  const rP = rankBy(s => s.perfect), rT = rankBy(s => s.total), rS = rankBy(s => s.students),
        rA = rankBy(s => s.avg), rR = rankBy(s => s.total ? s.perfect / s.total : 0);
  for (const s of schoolList) s.ranks = { perfect: rP.get(s.id), total: rT.get(s.id), students: rS.get(s.id), avg: rA.get(s.id), rate: rR.get(s.id) };

  return { year, stats, subjects: subjectList, schools: schoolList, students: compact };
}

// ---------- run ----------
const manifest = { generated: new Date().toISOString(), source: 'https://www.quppa.net/studyscores/browse/', years: [] };
// Cross-year search index, grouped by year. Within a year, array position == the
// student's index in that year's y{year}.json, so we store no id/year columns.
const globalSchoolNames = [];
const globalSchoolIdx = new Map();
const indexByYear = {}; // year -> { names:"a\nb\n...", sc:[...], c:[...], s:[...], top:[...] }
const subjectYears = new Map(); // subjectName -> Set(years)  (for global subject search + cross-year)
const scalingAll = {};          // year -> { subjectName: [11 scaled values] }  (cheap cross-year scaling)
let validationIssues = [];

for (const year of YEARS) {
  const y = buildYear(year);
  const file = `y${year}.json`;
  fs.writeFileSync(path.join(OUT, file), JSON.stringify(y));
  const bytes = fs.statSync(path.join(OUT, file)).size;

  // Validate against Statistics page
  const derivedScores = y.subjects.reduce((a, s) => a + s.n, 0);
  const schoolScoreSum = y.schools.reduce((a, s) => a + s.total, 0);
  const st = y.stats;
  const checks = [];
  if (st.totalStudents != null && st.totalStudents !== y.students.length) checks.push(`students ${y.students.length} vs stats ${st.totalStudents}`);
  if (st.totalScores != null && st.totalScores !== derivedScores) checks.push(`scores ${derivedScores} vs stats ${st.totalScores}`);
  if (st.totalScores != null && st.totalScores !== schoolScoreSum) checks.push(`schoolScoreSum ${schoolScoreSum} vs stats ${st.totalScores}`);
  if (st.totalSubjects != null && st.totalSubjects !== y.subjects.length) checks.push(`subjects ${y.subjects.length} vs stats ${st.totalSubjects}`);
  if (checks.length) validationIssues.push(`${year}: ${checks.join('; ')}`);

  const perfect = y.schools.reduce((a, s) => a + s.perfect, 0);
  const maxSum = y.students.reduce((a, s) => Math.max(a, s.s), 0);
  const distArr = [];
  for (let sc = 40; sc <= 50; sc++) distArr.push(st.dist[sc] || 0);
  manifest.years.push({
    y: year, students: y.students.length, scores: derivedScores, schools: y.schools.length,
    subjects: y.subjects.length, perfect, maxSum, bytes,
    scaledUpPct: st.scaledUp ? st.scaledUp.pct : null,
    scaledDownPct: st.scaledDown ? st.scaledDown.pct : null,
    dist: distArr,
  });

  // Cross-year index (grouped by year; row position == within-year student index)
  const names = [], sc = [], cs = [], ss = [], tp = [];
  y.students.forEach((st2) => {
    const sname = y.schools[st2.sc] ? y.schools[st2.sc].name : '';
    let sidx = globalSchoolIdx.get(sname);
    if (sidx === undefined) { sidx = globalSchoolNames.length; globalSchoolNames.push(sname); globalSchoolIdx.set(sname, sidx); }
    names.push(st2.n);
    sc.push(sidx);
    cs.push(st2.c);
    ss.push(st2.s);
    tp.push(st2.sj.reduce((mx, x) => Math.max(mx, x[1]), 0));
  });
  indexByYear[year] = { names: names.join('\n'), sc, c: cs, s: ss, top: tp };

  // Global subject presence + cheap cross-year scaling table
  scalingAll[year] = {};
  for (const sub of y.subjects) {
    if (!subjectYears.has(sub.name)) subjectYears.set(sub.name, []);
    subjectYears.get(sub.name).push(year);
    if (sub.scale) scalingAll[year][sub.name] = sub.scale;
  }

  process.stdout.write(`\r  built ${year}  (${y.students.length} students, ${y.schools.length} schools, ${y.subjects.length} subjects, ${(bytes/1024).toFixed(0)}KB)      `);
}

manifest.totals = {
  students: manifest.years.reduce((a, y) => a + y.students, 0),
  scores: manifest.years.reduce((a, y) => a + y.scores, 0),
  perfect: manifest.years.reduce((a, y) => a + y.perfect, 0),
  firstYear: YEARS[0], lastYear: YEARS[YEARS.length - 1], yearCount: YEARS.length,
};
// Subject index (name + years present + all-time score total) for instant subject search
manifest.subjects = [...subjectYears.entries()]
  .map(([name, years]) => ({ name, years }))
  .sort((a, b) => a.name.localeCompare(b.name));
fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest));
fs.writeFileSync(path.join(OUT, 'students-all.json'), JSON.stringify({ schools: globalSchoolNames, byYear: indexByYear }));
fs.writeFileSync(path.join(OUT, 'scaling-all.json'), JSON.stringify(scalingAll));

console.log('\n\n=== SUMMARY ===');
console.log(`Years: ${YEARS.length} (${YEARS[0]}..${YEARS[YEARS.length-1]})`);
console.log(`Total students (all years): ${manifest.totals.students.toLocaleString()}`);
console.log(`Total 40+ scores: ${manifest.totals.scores.toLocaleString()}`);
console.log(`manifest.json: ${(fs.statSync(path.join(OUT,'manifest.json')).size/1024).toFixed(1)} KB`);
console.log(`students-all.json: ${(fs.statSync(path.join(OUT,'students-all.json')).size/1024/1024).toFixed(2)} MB`);
const totalPerYear = manifest.years.reduce((a, y) => a + y.bytes, 0);
console.log(`per-year JSON total: ${(totalPerYear/1024/1024).toFixed(2)} MB  (avg ${(totalPerYear/YEARS.length/1024).toFixed(0)} KB/year)`);
if (validationIssues.length) {
  console.log(`\n!! VALIDATION ISSUES (${validationIssues.length}):`);
  validationIssues.forEach(v => console.log('   ' + v));
} else {
  console.log('\nAll years validated against Statistics pages ✓');
}
