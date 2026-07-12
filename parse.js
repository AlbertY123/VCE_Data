// Parse quppa.net HTML dumps into a compact, cross-indexed JSON for the static site.
// Computes:
//   - per-school score distribution + aggregates
//   - per-school list of subjects with: count of 40+, count of 50s, top score,
//     average, AND school's rank within that subject (50s desc, 40+ desc, avg desc)
//   - per-subject state-wide aggregates
//   - per-school list of top student ids
const fs = require('fs');

function parseStudents(html) {
  const students = [];
  const liRegex = /<li>\s*<h2>([^<]+?)\s*<span class="greytext">\(([^)]+)\)<\/span><\/h2>\s*<div>(\d+)\s+total\s+\(Sum:\s+(\d+)\)<\/div>\s*<ul>([\s\S]*?)<\/ul>\s*<\/li>/g;
  const subjRegex = /<li>([^<]+?):\s*(\d+)<\/li>/g;
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

const studentsHtml = fs.readFileSync('students_2024.html', 'utf8');
const schoolsHtml = fs.readFileSync('schools_2024.html', 'utf8');

const students = parseStudents(studentsHtml);
const schools = parseSchools(schoolsHtml);
console.log(`Parsed ${students.length} students, ${schools.length} schools`);

// Build school list with id
const schoolIdByName = new Map();
const schoolList = schools.map((s, i) => {
  schoolIdByName.set(s.name, i);
  return {
    id: i,
    name: s.name,
    total: s.total,
    counts: s.counts,
    perfect: s.counts['50'] || 0,
    students: 0,
    sumScore: 0,
    avgScore: 0,
    subjects: {},      // sjid -> { n, p, sum, top }
    subjectsList: [],  // built later
    topStudents: [],
  };
});

// Subject index
const subjectIdByName = new Map();
const subjectList = [];
function subjectId(name) {
  if (subjectIdByName.has(name)) return subjectIdByName.get(name);
  const id = subjectList.length;
  subjectIdByName.set(name, id);
  subjectList.push({
    id,
    name,
    total: 0,
    perfect: 0,
    sum: 0,
    avg: 0,
    numSchools: 0,
    schoolEntries: [], // temp: list of school subject aggregates for ranking
  });
  return id;
}

// Compact students with school + subject ids
const compactStudents = students.map((st) => {
  let scid = schoolIdByName.get(st.sc);
  if (scid === undefined) {
    scid = schoolList.length;
    schoolIdByName.set(st.sc, scid);
    schoolList.push({
      id: scid, name: st.sc, total: 0, counts: {}, perfect: 0, students: 0,
      sumScore: 0, avgScore: 0, subjects: {}, subjectsList: [], topStudents: [],
    });
  }
  const school = schoolList[scid];
  school.students++;
  school.sumScore += st.s;
  const sj = st.sj.map(([n, sc]) => {
    const sjid = subjectId(n);
    const sub = subjectList[sjid];
    sub.total++;
    sub.sum += sc;
    if (sc === 50) sub.perfect++;
    let agg = school.subjects[sjid];
    if (!agg) agg = school.subjects[sjid] = { n: 0, p: 0, sum: 0, top: 0 };
    agg.n++;
    agg.sum += sc;
    if (sc === 50) agg.p++;
    if (sc > agg.top) agg.top = sc;
    return [sjid, sc];
  });
  return { n: st.n, sc: scid, c: st.c, s: st.s, sj };
});

// Per-school finalize: avg sum, top students
for (const school of schoolList) {
  school.avgScore = school.students ? +(school.sumScore / school.students).toFixed(1) : 0;
}
const studentsBySchool = new Map();
compactStudents.forEach((st, i) => {
  if (!studentsBySchool.has(st.sc)) studentsBySchool.set(st.sc, []);
  studentsBySchool.get(st.sc).push(i);
});
for (const [scid, ids] of studentsBySchool) {
  ids.sort((a, b) => compactStudents[b].s - compactStudents[a].s || compactStudents[b].c - compactStudents[a].c);
  schoolList[scid].topStudents = ids.slice(0, 25);
}

// Build subject schoolEntries
for (const school of schoolList) {
  for (const sjidStr of Object.keys(school.subjects)) {
    const sjid = +sjidStr;
    const agg = school.subjects[sjid];
    subjectList[sjid].schoolEntries.push({ scid: school.id, n: agg.n, p: agg.p, avg: agg.sum / agg.n, top: agg.top });
  }
}

// Rank schools within each subject (50s desc, 40+ desc, avg desc)
for (const sub of subjectList) {
  sub.schoolEntries.sort((a, b) => b.p - a.p || b.n - a.n || b.avg - a.avg);
  sub.numSchools = sub.schoolEntries.length;
  sub.avg = sub.total ? +(sub.sum / sub.total).toFixed(2) : 0;
  sub.schoolEntries.forEach((entry, i) => {
    const rank = i + 1;
    const school = schoolList[entry.scid];
    school.subjectsList.push({
      sjid: sub.id,
      n: entry.n,
      p: entry.p,
      top: entry.top,
      avg: +entry.avg.toFixed(2),
      r: rank,
    });
  });
  delete sub.schoolEntries;
}

// Sort each school's subjectsList by strength (rank ascending, then 40+ desc)
for (const school of schoolList) {
  school.subjectsList.sort((a, b) => a.r - b.r || b.n - a.n);
  delete school.subjects;
  delete school.sumScore;
}

// Pre-compute school-level ranks (overall metrics) for badge display
function rankBy(arr, keyFn) {
  const sorted = arr.slice().sort((a, b) => keyFn(b) - keyFn(a));
  const ranks = new Map();
  sorted.forEach((s, i) => ranks.set(s.id, i + 1));
  return ranks;
}
const rankPerfect = rankBy(schoolList, s => s.perfect);
const rankTotal = rankBy(schoolList, s => s.total);
const rankStudents = rankBy(schoolList, s => s.students);
const rankAvg = rankBy(schoolList, s => s.avgScore);
const rankRate = rankBy(schoolList, s => s.total ? s.perfect / s.total : 0);
for (const s of schoolList) {
  s.ranks = {
    perfect: rankPerfect.get(s.id),
    total: rankTotal.get(s.id),
    students: rankStudents.get(s.id),
    avg: rankAvg.get(s.id),
    rate: rankRate.get(s.id),
  };
}

const data = {
  year: 2024,
  generated: new Date().toISOString(),
  totalSchools: schoolList.length,
  schools: schoolList,
  students: compactStudents,
  subjects: subjectList,
};

fs.writeFileSync('data.json', JSON.stringify(data));
console.log(`Wrote data.json (${(fs.statSync('data.json').size/1024/1024).toFixed(2)} MB) — ${subjectList.length} subjects`);
