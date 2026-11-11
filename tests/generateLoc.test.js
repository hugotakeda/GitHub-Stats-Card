'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { CACHE_VERSION, collectLoc, isGraphRefresh, renderSvg } = require('../scripts/generateLoc');
const username = 'hugotakeda';
const repo = (name, head = 'head1') => ({ nameWithOwner: username + '/' + name,
  defaultBranchRef: head ? { target: { oid: head } } : null });
const connection = (nodes, cursor = null) => ({ nodes,
  pageInfo: { hasNextPage: !!cursor, endCursor: cursor } });
const commit = (additions, deletions, extras = {}) => ({ additions, deletions,
  messageHeadline: 'Human change', committer: { user: { login: 'web-flow' } }, ...extras });
function fixture({ repoPages, histories = {}, authorId = 'user1' }) {
  const calls = [];
  const fetchImpl = async (_url, options) => {
    const body = JSON.parse(options.body);
    const v = body.variables;
    calls.push(body);
    let data;
    if (body.query.includes('user(login:')) {
      assert.match(body.query, /isFork: false, privacy: PUBLIC/);
      assert.match(body.query, /ownerAffiliations: \[OWNER\]/);
      data = { user: { id: authorId, repositories: repoPages[v.after || 'first'] } };
    } else {
      assert.equal(v.author, authorId);
      assert.equal(typeof v.head, 'string');
      data = { repository: { object: { history: histories[v.name + ':' + (v.after || 'first')] } } };
    }
    return { ok: true, json: async () => ({ data }) };
  };
  return { calls, fetchImpl };
}

test('counts all repository/history pages and excludes known automated graph changes', async () => {
  const auto = commit(900, 800, { messageHeadline: 'chore: update energy rhythm graph [skip ci]',
    committer: { user: { login: 'github-actions[bot]' } } });
  const mock = fixture({
    repoPages: { first: connection([repo('GitHub-Contribution-Graph')], 'page2'),
      page2: connection([repo('app'), repo('empty', null)]) },
    histories: { 'GitHub-Contribution-Graph:first': connection([auto, commit(30, 5)], 'older'),
      'GitHub-Contribution-Graph:older': connection([commit(20, 2)]),
      'app:first': connection([commit(50, 3)]) },
  });
  const stats = await collectLoc({ username, token: 'test', fetchImpl: mock.fetchImpl });
  assert.deepEqual([stats.added, stats.deleted, stats.net, stats.repos], [100, 10, 90, 3]);
  assert.equal(stats.scanned, 2);
  assert.equal(mock.calls.length, 5);
});

test('valid unchanged cache avoids history calls and prunes removed repos', async () => {
  const previous = { version: CACHE_VERSION, authorId: 'user1', repositories: {
    'hugotakeda/app': { head: 'head1', added: 12, deleted: 20 },
    'hugotakeda/deleted': { head: 'gone', added: 1000, deleted: 0 },
  } };
  const mock = fixture({ repoPages: { first: connection([repo('app')]) } });
  const stats = await collectLoc({ username, token: 'test', previous, fetchImpl: mock.fetchImpl });
  assert.equal(stats.net, -8);
  assert.equal(stats.reused, 1);
  assert.equal(mock.calls.length, 1);
  assert.deepEqual(Object.keys(stats.cache.repositories), ['hugotakeda/app']);
  assert.ok(previous.repositories['hugotakeda/deleted']); // input cache stays untouched
});

test('changed heads, account, rules and invalid cache values force recomputation', async () => {
  for (const variant of ['head', 'account', 'version', 'invalid']) {
    const previous = { version: variant === 'version' ? 0 : CACHE_VERSION,
      authorId: variant === 'account' ? 'other' : 'user1', repositories: {
        'hugotakeda/app': { head: variant === 'head' ? 'old' : 'head1',
          added: variant === 'invalid' ? -1 : 100, deleted: 10 },
      } };
    const mock = fixture({ repoPages: { first: connection([repo('app')]) },
      histories: { 'app:first': connection([commit(7, 2)]) } });
    const stats = await collectLoc({ username, token: 'test', previous, fetchImpl: mock.fetchImpl });
    assert.equal(stats.net, 5);
    assert.equal(stats.scanned, 1);
  }
});

test('automation filtering is narrow and preserves human work in the graph repo', () => {
  const auto = commit(1, 1, { messageHeadline: 'chore: update energy rhythm graph [skip ci]',
    committer: { user: { login: 'github-actions[bot]' } } });
  assert.ok(isGraphRefresh('hugotakeda/Energy-Rhythm-Contribution-Graph', auto, username));
  assert.ok(!isGraphRefresh('hugotakeda/app', auto, username));
  assert.ok(!isGraphRefresh('hugotakeda/GitHub-Contribution-Graph', commit(1, 1), username));
  assert.ok(!isGraphRefresh('hugotakeda/GitHub-Contribution-Graph',
    { ...auto, committer: { user: { login: 'web-flow' } } }, username));
});

test('empty accounts return real zeroes', async () => {
  const mock = fixture({ repoPages: { first: connection([]) } });
  const stats = await collectLoc({ username, token: 'test', fetchImpl: mock.fetchImpl });
  assert.equal(stats.net, 0);
  assert.equal(stats.repos, 0);
});

test('API errors and missing histories reject rather than returning partial totals', async () => {
  const cases = [
    async () => ({ ok: false, status: 403 }),
    async () => ({ ok: true, json: async () => ({ errors: [{ message: 'rate limit' }] }) }),
    fixture({ repoPages: { first: connection([repo('app')]) } }).fetchImpl,
  ];
  for (const fetchImpl of cases) await assert.rejects(collectLoc({ username, token: 'test', fetchImpl }));
});

test('SVG preserves exact totals, negative balances and XML-safe names', () => {
  const svg = renderSvg('name<&"', { net: -10, added: 20, deleted: 30, repos: 2 });
  assert.ok(svg.includes('name&lt;&amp;&quot;'));
  assert.ok(svg.includes('>−30</text>'));
  assert.ok(svg.includes('>-10</text>'));
  assert.ok(svg.includes('width="775"'));
  const large = renderSvg(username, { net: 12345678901, added: 12345678902, deleted: 1, repos: 2 });
  assert.ok(large.includes('12,345,678,901'));
  assert.ok(large.includes('12.35B'));
});
