// Download all raw HTML pages from quppa.net for every available year.
// Caches to raw/{year}/{students,schools,scaling,stats}.html so re-runs are instant.
const fs = require('fs');
const path = require('path');

const YEARS = [1998, ...Array.from({ length: 26 }, (_, i) => 2000 + i)]; // 1998, 2000..2025
const BASE = 'https://www.quppa.net/studyscores/browse';
const PAGES = {
  students: 'All Students, Sorted by Highest Scores.html',
  schools: 'Score Counts, Grouped by School, Sorted by Highest Scores.html',
  scaling: 'Scaling Table.html',
  stats: 'Statistics.html',
};

const RAW = path.join(__dirname, 'raw');
fs.mkdirSync(RAW, { recursive: true });

function urlFor(year, page) {
  // Encode the filename but keep the slash structure.
  return `${BASE}/${year}/${encodeURIComponent(page)}`;
}

async function fetchWithRetry(url, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (data-archive-mirror)' },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      if (text.length < 200) throw new Error('suspiciously short');
      return text;
    } catch (e) {
      if (i === tries - 1) throw e;
      await new Promise(r => setTimeout(r, 400 * (i + 1)));
    }
  }
}

const jobs = [];
for (const year of YEARS) {
  fs.mkdirSync(path.join(RAW, String(year)), { recursive: true });
  for (const [key, page] of Object.entries(PAGES)) {
    const dest = path.join(RAW, String(year), `${key}.html`);
    jobs.push({ year, key, url: urlFor(year, page), dest });
  }
}

let done = 0, failed = [];
async function worker(queue) {
  while (queue.length) {
    const job = queue.shift();
    if (fs.existsSync(job.dest) && fs.statSync(job.dest).size > 200) {
      done++;
      continue;
    }
    try {
      const html = await fetchWithRetry(job.url);
      fs.writeFileSync(job.dest, html);
      done++;
      process.stdout.write(`\r  ${done}/${jobs.length} downloaded  (last: ${job.year}/${job.key}, ${(html.length/1024).toFixed(0)}KB)      `);
    } catch (e) {
      failed.push({ ...job, error: e.message });
      done++;
    }
  }
}

(async () => {
  const CONCURRENCY = 6;
  const queue = jobs.slice();
  console.log(`Downloading ${jobs.length} pages across ${YEARS.length} years (concurrency ${CONCURRENCY})...`);
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker(queue)));
  console.log('\nDone.');
  if (failed.length) {
    console.log(`FAILED (${failed.length}):`);
    failed.forEach(f => console.log(`  ${f.year}/${f.key}: ${f.error}`));
  }
  // Size summary
  let total = 0;
  for (const year of YEARS) {
    for (const key of Object.keys(PAGES)) {
      const p = path.join(RAW, String(year), `${key}.html`);
      if (fs.existsSync(p)) total += fs.statSync(p).size;
    }
  }
  console.log(`Total cached: ${(total/1024/1024).toFixed(1)} MB`);
})();
