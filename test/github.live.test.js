// Live check of the GitHub App path against a sandbox repository.
// Opt in:  LIVE_REPO=owner/repo LIVE_INSTALLATION=123 GITHUB_APP_ID=... GITHUB_APP_PRIVATE_KEY_B64=... \
//          node --experimental-test-module-mocks --test test/github.live.test.js
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

const { LIVE_REPO, LIVE_INSTALLATION } = process.env;
const skip = !LIVE_REPO || !LIVE_INSTALLATION;

test('GitHub App path: token, config, refs, create, pulls', { skip }, async () => {
  mock.module('@forge/api', { exports: { default: {}, fetch: globalThis.fetch } });
  const gh = await import('../src/lib/github.js');
  const repoName = LIVE_REPO.split('/')[1];
  const token = await gh.installationToken(LIVE_INSTALLATION, repoName);
  assert.match(token, /^ghs_/);

  const reach = await fetch('https://api.github.com/installation/repositories', { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' } });
  const repos = (await reach.json()).repositories.map((r) => r.full_name);
  assert.deepEqual(repos, [LIVE_REPO], 'the token must reach the sandbox repository and nothing else');

  assert.equal(await gh.readRepoConfig(token, LIVE_REPO), '');
  const branch = `LIVE-${Date.now()}`;
  assert.deepEqual(await gh.matchingBranches(token, LIVE_REPO, branch), []);
  assert.equal(await gh.branchSha(token, LIVE_REPO, 'no-such-branch'), null);
  const sha = await gh.branchSha(token, LIVE_REPO, 'main');
  assert.match(sha, /^[0-9a-f]{40}$/);
  assert.equal(await gh.createBranch(token, LIVE_REPO, branch, sha), 'created');
  assert.equal(await gh.createBranch(token, LIVE_REPO, branch, sha), 'exists');
  assert.deepEqual(await gh.matchingBranches(token, LIVE_REPO, branch), [branch]);
  assert.deepEqual(await gh.pullsForBranch(token, LIVE_REPO, branch), []);
  const del = await fetch(`https://api.github.com/repos/${LIVE_REPO}/git/refs/heads/${branch}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' } });
  assert.equal(del.status, 204);
});
