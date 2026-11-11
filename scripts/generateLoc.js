'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

// Bump when counting rules change so cached totals cannot use older rules.
const CACHE_VERSION = 1;
const REPOS_QUERY = `
  query($login: String!, $after: String) {
    user(login: $login) {
      id
      repositories(first: 100, after: $after, ownerAffiliations: [OWNER],
        isFork: false, privacy: PUBLIC, orderBy: {field: NAME, direction: ASC}) {
        pageInfo { hasNextPage endCursor }
        nodes { nameWithOwner defaultBranchRef { target { oid } } }
      }
    }
  }`;
const HISTORY_QUERY = `
  query($owner: String!, $name: String!, $head: String!, $author: ID!, $after: String) {
    repository(owner: $owner, name: $name) {
      object(expression: $head) {
        ... on Commit {
          history(first: 100, after: $after, author: {id: $author}) {
            pageInfo { hasNextPage endCursor }
            nodes {
              additions deletions messageHeadline
              committer { user { login } }
            }
          }
        }
      }
    }
  }`;

function isGraphRefresh(repository, commit, username) {
  const names = ['GitHub-Contribution-Graph', 'Energy-Rhythm-Contribution-Graph']
    .map(name => `${username}/${name}`.toLowerCase());
  return names.includes(repository.toLowerCase())
    && commit.messageHeadline === 'chore: update energy rhythm graph [skip ci]'
    && commit.committer?.user?.login === 'github-actions[bot]';
}

function validCount(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function nextCursor(connection) {
  const { hasNextPage, endCursor } = connection.pageInfo;
  if (hasNextPage && !endCursor) throw new Error('GitHub returned an incomplete page cursor');
  return hasNextPage ? endCursor : null;
}

async function collectLoc({ username, token, previous = {}, fetchImpl = fetch }) {
  async function query(document, variables) {
    const response = await fetchImpl('https://api.github.com/graphql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ query: document, variables }),
      signal: AbortSignal.timeout(60000),
    });
    if (!response.ok) throw new Error(`GitHub API returned HTTP ${response.status}`);
    const payload = await response.json();
    if (payload.errors?.length) throw new Error(payload.errors.map(e => e.message).join('; '));
    if (!payload.data) throw new Error('GitHub returned no data');
    return payload.data;
  }

  const repos = [];
  let authorId;
  let after = null;
  do {
    const data = await query(REPOS_QUERY, { login: username, after });
    if (!data.user) throw new Error(`GitHub user not found: ${username}`);
    authorId = data.user.id;
    repos.push(...data.user.repositories.nodes);
    after = nextCursor(data.user.repositories);
  } while (after);

  const oldRepos = previous.version === CACHE_VERSION && previous.authorId === authorId
    ? (previous.repositories || {}) : {};
  // Build a new cache: deleted, transferred, or newly private repos are pruned.
  const cache = { version: CACHE_VERSION, authorId, repositories: {} };
  let added = 0, deleted = 0, reused = 0, scanned = 0;
  for (const repo of repos) {
    const head = repo.defaultBranchRef?.target?.oid;
    if (!head) continue;
    const cached = oldRepos[repo.nameWithOwner];
    let totals;
    if (cached?.head === head && validCount(cached.added) && validCount(cached.deleted)) {
      totals = { head, added: cached.added, deleted: cached.deleted };
      reused++;
    } else {
      const [owner, name] = repo.nameWithOwner.split('/');
      totals = { head, added: 0, deleted: 0 };
      after = null;
      do {
        const data = await query(HISTORY_QUERY, { owner, name, head, author: authorId, after });
        const history = data.repository?.object?.history;
        if (!history) throw new Error(`History unavailable for ${repo.nameWithOwner}`);
        for (const commit of history.nodes) {
          if (isGraphRefresh(repo.nameWithOwner, commit, username)) continue;
          if (!validCount(commit.additions) || !validCount(commit.deletions)) {
            throw new Error('GitHub returned invalid line counts');
          }
          totals.added += commit.additions;
          totals.deleted += commit.deletions;
        }
        after = nextCursor(history);
      } while (after);
      scanned++;
    }
    cache.repositories[repo.nameWithOwner] = totals;
    added += totals.added;
    deleted += totals.deleted;
  }
  if (!validCount(added) || !validCount(deleted)) throw new Error('Line totals exceed safe integer range');
  return { added, deleted, net: added - deleted, repos: repos.length, scanned, reused, cache };
}

function escapeXml(text) {
  return String(text).replace(/[&<>"']/g, char =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]);
}

function renderSvg(username, stats) {
  const format = value => value.toLocaleString('en-US');
  const exact = value => escapeXml(format(value));
  // Keep exceptionally large values inside their columns; titles retain exact totals.
  const display = value => Math.abs(value) >= 1e7
    ? new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(value)
    : format(value);
  const safeUser = escapeXml(username);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="775" height="164" viewBox="0 0 775 164" role="img" aria-labelledby="title desc">
  <title id="title">Lines of Code — ${safeUser}</title>
  <desc id="desc">Net historical changes: ${exact(stats.net)} lines. ${exact(stats.added)} added; ${exact(stats.deleted)} removed. Authored commits on default branches of ${stats.repos} public owned non-fork repositories. Known graph refresh automation excluded. Includes all text files.</desc>
  <style>
    text { font-family: 'Segoe UI', Ubuntu, sans-serif; }
    .title { font-size: 16px; font-weight: 600; fill: #e6edf3; }
    .label { font-size: 12px; fill: #8b949e; }
    .number { font-size: 28px; font-weight: 650; font-variant-numeric: tabular-nums; }
    .note { font-size: 10px; fill: #8b949e; }
  </style>
  <rect width="775" height="164" rx="8" fill="#0d1117"/>
  <text x="30" y="32" class="title">Lines of Code</text>
  <text x="745" y="32" text-anchor="end" class="note">All-time history</text>
  <path d="M287 56v57 M532 56v57" stroke="#30363d" opacity=".55"/>
  <g><title>${exact(stats.net)} net lines changed</title>
    <text x="30" y="68" class="label">Net lines changed</text>
    <text x="30" y="103" class="number" fill="#e6edf3">${escapeXml(display(stats.net))}</text>
  </g>
  <g><title>${exact(stats.added)} lines added</title>
    <text x="317" y="68" class="label">Lines added</text>
    <text x="317" y="103" class="number" fill="#3fb950">+${escapeXml(display(stats.added))}</text>
  </g>
  <g><title>${exact(stats.deleted)} lines removed</title>
    <text x="562" y="68" class="label">Lines removed</text>
    <text x="562" y="103" class="number" fill="#ff7b72">−${escapeXml(display(stats.deleted))}</text>
  </g>
  <text x="30" y="142" class="note">Authored changes · Public owned repos · Default branches · Excludes known graph refreshes</text>
</svg>\n`;
}

async function main() {
  const username = process.env.GITHUB_USERNAME;
  const token = process.env.GH_TOKEN;
  if (!username || !token) throw new Error('GITHUB_USERNAME and GH_TOKEN are required');
  const root = path.resolve(__dirname, '..');
  const cachePath = path.join(root, '.cache', 'loc.json');
  let previous = {};
  try {
    previous = JSON.parse(await fs.readFile(cachePath, 'utf8'));
    if (!previous || typeof previous !== 'object') previous = {};
  } catch (error) {
    if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
  }
  // Do not overwrite the previous published SVG if any request fails.
  const stats = await collectLoc({ username, token, previous });
  const svg = renderSvg(username, stats);
  await fs.mkdir(path.join(root, 'dist'), { recursive: true });
  await fs.mkdir(path.dirname(cachePath), { recursive: true });
  await fs.writeFile(cachePath, JSON.stringify(stats.cache), 'utf8');
  await fs.writeFile(path.join(root, 'dist', 'lines-of-code.svg'), svg, 'utf8');
  console.log(`LOC: ${stats.net} net (+${stats.added} / -${stats.deleted}); ${stats.scanned} scanned, ${stats.reused} cached.`);
}

module.exports = { CACHE_VERSION, collectLoc, isGraphRefresh, renderSvg };
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
