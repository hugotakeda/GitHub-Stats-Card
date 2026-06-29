// @ts-check
'use strict';

const fs   = require('fs');
const path = require('path');

// ── Config ───────────────────────────────────────────────────────────────────
const USERNAME = process.env.GITHUB_USERNAME || process.argv[2];
const TOKEN    = process.env.GH_TOKEN        || process.argv[3];

if (!USERNAME) { console.error('Error: GITHUB_USERNAME is not set.'); process.exit(1); }
if (!TOKEN)    { console.error('Error: GH_TOKEN is not set.');        process.exit(1); }

console.log(`🚀 Starting SVG generation for: ${USERNAME}`);

// ── Energy Rhythm Palette ────────────────────────────────────────────────────
const C = {
  bg:        '#0d1117',
  border:    '#30363d',
  title:     '#e6edf3',
  label:     '#8b949e',
  value:     '#e6edf3',
  purple:    '#6e40c9',
  gold:      '#f2cc60',
  orange:    '#ff7b72',
  green:     '#3fb950',
  cyan:      '#58a6ff',
};

// ── Fallback language colors (GitHub defaults) ───────────────────────────────
const LANG_FALLBACK = {
  JavaScript:  '#f1e05a', TypeScript: '#3178c6', Python: '#3572A5',
  Java:        '#b07219', HTML:       '#e34c26', CSS:    '#563d7c',
  'C++':       '#f34b7d', C:          '#555555', 'C#':   '#178600',
  Go:          '#00ADD8', Rust:       '#dea584', Ruby:   '#701516',
  PHP:         '#4F5D95', Swift:      '#F05138', Kotlin: '#A97BFF',
  Shell:       '#89e051', Lua:        '#000080', GLSL:   '#5686a5',
  Dart:        '#00B4AB', Vue:        '#41b883', SCSS:   '#c6538c',
  Dockerfile:  '#384d54', Makefile:   '#427819', Jupyter: '#DA5B0B',
};

// ═════════════════════════════════════════════════════════════════════════════
//  1. FETCH STATS VIA GRAPHQL
// ═════════════════════════════════════════════════════════════════════════════
async function fetchStats(username, token) {
  const query = `
    query($username: String!) {
      user(login: $username) {
        repositories(
          first: 100
          ownerAffiliations: [OWNER, COLLABORATOR]
          isFork: false
          orderBy: { field: STARGAZERS, direction: DESC }
        ) {
          nodes {
            stargazerCount
            languages(first: 10, orderBy: { field: SIZE, direction: DESC }) {
              edges {
                size
                node { name  color }
              }
            }
          }
        }
        contributionsCollection {
          totalCommitContributions
          totalPullRequestContributions
          totalIssueContributions
        }
        repositoriesContributedTo(
          first: 1
          contributionTypes: [COMMIT, PULL_REQUEST, REPOSITORY]
        ) {
          totalCount
        }
        pullRequests(first: 1)  { totalCount }
        issues(first: 1)        { totalCount }
      }
    }
  `;

  const res = await fetch('https://api.github.com/graphql', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body:    JSON.stringify({ query, variables: { username } }),
  });

  if (!res.ok) throw new Error(`GitHub API ${res.status}: ${await res.text()}`);
  const { data, errors } = await res.json();
  if (errors) throw new Error('GraphQL: ' + errors.map(e => e.message).join(', '));

  const u = data.user;

  // Total stars
  const totalStars = u.repositories.nodes.reduce((s, r) => s + r.stargazerCount, 0);

  // Aggregate languages
  const langMap = new Map();
  for (const repo of u.repositories.nodes) {
    for (const edge of (repo.languages?.edges || [])) {
      const name = edge.node.name;
      const prev = langMap.get(name) || { size: 0, color: edge.node.color };
      prev.size += edge.size;
      langMap.set(name, prev);
    }
  }

  const totalSize = [...langMap.values()].reduce((s, l) => s + l.size, 0);
  const languages = [...langMap.entries()]
    .sort((a, b) => b[1].size - a[1].size)
    .slice(0, 6)
    .map(([name, { size, color }]) => ({
      name,
      pct:   ((size / totalSize) * 100).toFixed(2),
      color: color || LANG_FALLBACK[name] || '#8b949e',
    }));

  return {
    totalStars,
    totalCommits:  u.contributionsCollection.totalCommitContributions,
    totalPRs:      u.pullRequests.totalCount,
    totalIssues:   u.issues.totalCount,
    contributedTo: u.repositoriesContributedTo.totalCount,
    languages,
    year:          new Date().getFullYear(),
  };
}

// ═════════════════════════════════════════════════════════════════════════════
//  2. GRADE CALCULATION
// ═════════════════════════════════════════════════════════════════════════════
function calculateGrade(stats) {
  const raw =
    stats.totalCommits      * 1 +
    stats.totalPRs          * 3 +
    stats.totalStars        * 5 +
    stats.totalIssues       * 1 +
    stats.contributedTo     * 2;

  // Logistic curve → 0‥1
  const pct = 1 - 1 / (1 + raw / 100);

  let grade, color;
  if      (pct >= 0.95) { grade = 'S';  color = C.gold;   }
  else if (pct >= 0.85) { grade = 'A+'; color = C.purple; }
  else if (pct >= 0.70) { grade = 'A';  color = C.green;  }
  else if (pct >= 0.55) { grade = 'B+'; color = C.cyan;   }
  else if (pct >= 0.40) { grade = 'B';  color = C.orange; }
  else                  { grade = 'C';  color = C.orange;  }

  return { grade, pct, color };
}

// ═════════════════════════════════════════════════════════════════════════════
//  3. SVG GENERATION
// ═════════════════════════════════════════════════════════════════════════════
function fmt(n) { return n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n); }

function esc(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

function generateSvg(username, stats) {
  const { grade, pct, color: gradeColor } = calculateGrade(stats);

  // ── Dimensions ──
  const W = 775, H = 250;
  const DIV_X = 410;                       // vertical divider

  // ── Stat rows ──
  const rows = [
    { label: 'Total Stars Earned',             val: stats.totalStars,    color: C.gold   },
    { label: `Total Commits (${stats.year})`,  val: stats.totalCommits,  color: C.green  },
    { label: 'Total PRs',                      val: stats.totalPRs,      color: C.purple },
    { label: 'Total Issues',                   val: stats.totalIssues,   color: C.orange },
    { label: 'Contributed to (last year)',      val: stats.contributedTo, color: C.cyan   },
  ];

  const ROW_Y0 = 80, ROW_DY = 34;
  let statsSvg = '';
  rows.forEach((r, i) => {
    const y = ROW_Y0 + i * ROW_DY;
    statsSvg += `
      <g class="fade-l" style="animation-delay:${150 + i * 100}ms">
        <circle cx="38" cy="${y}" r="4.5" fill="${r.color}" opacity="0.9"/>
        <text x="56" y="${y + 4.5}" class="lbl">${r.label}</text>
        <text x="300" y="${y + 4.5}" class="val" text-anchor="end">${fmt(r.val)}</text>
      </g>`;
  });

  // ── Grade ring ──
  const RCX = 360, RCY = 155, RR = 30;
  const circ = 2 * Math.PI * RR;
  const dashOff = circ * (1 - pct);

  // ── Language bar ──
  const BAR_X = 435, BAR_Y = 65, BAR_W = 310, BAR_H = 10;
  let barSegs = '';
  let bx = BAR_X;
  stats.languages.forEach(l => {
    const w = (parseFloat(l.pct) / 100) * BAR_W;
    barSegs += `<rect x="${bx}" y="${BAR_Y}" width="${Math.max(w, 1)}" height="${BAR_H}" fill="${l.color}"/>`;
    bx += w;
  });

  // ── Language legend (2 columns) ──
  const half = Math.ceil(stats.languages.length / 2);
  let legendSvg = '';
  stats.languages.forEach((l, i) => {
    const col = i < half ? 0 : 1;
    const row = i < half ? i : i - half;
    const lx = 435 + col * 165;
    const ly = 105 + row * 38;
    legendSvg += `
      <g class="fade-r" style="animation-delay:${400 + i * 80}ms">
        <circle cx="${lx}" cy="${ly}" r="5" fill="${l.color}"/>
        <text x="${lx + 14}" y="${ly + 4}" class="lname">${esc(l.name)}</text>
        <text x="${lx + 14}" y="${ly + 19}" class="lpct">${l.pct}%</text>
      </g>`;
  });

  // ── Assemble SVG ──
  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"
     xmlns="http://www.w3.org/2000/svg" role="img"
     aria-label="${esc(username)}'s GitHub Stats">

  <title>${esc(username)}'s GitHub Stats</title>

  <defs>
    <clipPath id="bar-clip">
      <rect x="${BAR_X}" y="${BAR_Y}" width="${BAR_W}" height="${BAR_H}" rx="${BAR_H / 2}"/>
    </clipPath>
    <linearGradient id="ring-grad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%"   stop-color="${gradeColor}"/>
      <stop offset="100%" stop-color="${gradeColor}" stop-opacity="0.55"/>
    </linearGradient>
  </defs>

  <style>
    @keyframes fadeL  { from { opacity:0; transform:translateX(-8px) } to { opacity:1; transform:translateX(0) } }
    @keyframes fadeR  { from { opacity:0; transform:translateX(8px)  } to { opacity:1; transform:translateX(0) } }
    @keyframes ring   { from { stroke-dashoffset:${circ} } to { stroke-dashoffset:${dashOff} } }
    @keyframes pop    { from { opacity:0; transform:scale(.5) } to { opacity:1; transform:scale(1) } }
    @keyframes barIn  { from { transform:scaleX(0) } to { transform:scaleX(1) } }

    .ttl   { font:600 16px 'Segoe UI',Ubuntu,'Helvetica Neue',sans-serif; fill:${C.title} }
    .lbl   { font:400 13.5px 'Segoe UI',Ubuntu,sans-serif; fill:${C.label} }
    .val   { font:700 13.5px 'Segoe UI',Ubuntu,sans-serif; fill:${C.value} }
    .grd   { font:800 22px  'Segoe UI',Ubuntu,sans-serif; fill:${gradeColor} }
    .lname { font:600 12px  'Segoe UI',Ubuntu,sans-serif; fill:${C.title} }
    .lpct  { font:400 11px  'Segoe UI',Ubuntu,sans-serif; fill:${C.label} }

    .fade-l     { animation:fadeL .6s ease forwards; opacity:0 }
    .fade-r     { animation:fadeR .5s ease forwards; opacity:0 }
    .grade-ring { animation:ring 1.4s ease-out forwards; stroke-dashoffset:${circ} }
    .grade-ltr  { animation:pop .5s ease forwards; animation-delay:.8s; opacity:0;
                  transform-origin:${RCX}px ${RCY}px }
    .bar-group  { animation:barIn .8s ease-out forwards; transform-origin:${BAR_X}px ${BAR_Y + BAR_H / 2}px }
  </style>

  <!-- ─── Background ─── -->
  <rect x="0" y="0" width="${W}" height="${H}" rx="8" ry="8"
        fill="${C.bg}"/>

  <!-- ─── Divider ─── -->
  <line x1="${DIV_X}" y1="22" x2="${DIV_X}" y2="${H - 22}"
        stroke="${C.border}" stroke-width="1" opacity=".4"/>

  <!-- ═══ LEFT: Stats ═══ -->
  <text x="30" y="44" class="ttl">${esc(username)}'s GitHub Stats</text>
  ${statsSvg}

  <!-- Grade Ring -->
  <circle cx="${RCX}" cy="${RCY}" r="${RR}" fill="none"
          stroke="${C.border}" stroke-width="5" opacity=".25"/>
  <circle cx="${RCX}" cy="${RCY}" r="${RR}" fill="none"
          stroke="url(#ring-grad)" stroke-width="5"
          stroke-dasharray="${circ}" stroke-linecap="round"
          transform="rotate(-90,${RCX},${RCY})"
          class="grade-ring"/>
  <g class="grade-ltr">
    <text x="${RCX}" y="${RCY + 8}" text-anchor="middle" class="grd">${grade}</text>
  </g>

  <!-- ═══ RIGHT: Languages ═══ -->
  <text x="435" y="44" class="ttl">Most Used Languages</text>

  <!-- Language bar -->
  <g clip-path="url(#bar-clip)" class="bar-group">
    ${barSegs}
  </g>

  <!-- Language legend -->
  ${legendSvg}

</svg>`;
}

// ═════════════════════════════════════════════════════════════════════════════
//  MAIN
// ═════════════════════════════════════════════════════════════════════════════
async function main() {
  console.log(`Fetching stats for ${USERNAME}…`);
  const stats = await fetchStats(USERNAME, TOKEN);

  console.log('📊 Stats:', {
    stars:   stats.totalStars,
    commits: stats.totalCommits,
    prs:     stats.totalPRs,
    issues:  stats.totalIssues,
    contribs: stats.contributedTo,
    langs:   stats.languages.map(l => `${l.name} ${l.pct}%`),
  });

  const { grade, pct } = calculateGrade(stats);
  console.log(`🏅 Grade: ${grade}  (${(pct * 100).toFixed(1)}%)`);

  const svg = generateSvg(USERNAME, stats);

  const outDir = path.join(__dirname, '..', 'dist');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'github-stats.svg');
  fs.writeFileSync(outPath, svg);

  console.log(`✅ SVG saved → ${outPath}`);
}

main().catch(err => { console.error('❌', err); process.exit(1); });
