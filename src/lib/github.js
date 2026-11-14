// GitHub access for the Forge port.
// Two identities, the same two the Connect app used:
//   1. the signed-in user (OAuth token held by Forge external auth, never by this code), to list what they can reach;
//   2. the GitHub App installation (short-lived token minted from the app's private key), to create the branch.
import crypto from 'node:crypto';
import api, { fetch } from '@forge/api';

const API = 'https://api.github.com';
const HEADERS = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'github-branches-forge-port' };

export class GitHubError extends Error {
  constructor(fn, status, detail) {
    super(`${fn}: GitHub answered ${status}${detail ? ` (${detail})` : ''}`);
    this.status = status;
  }
}

async function detail(res) {
  try {
    const body = await res.json();
    return typeof body?.message === 'string' ? body.message.slice(0, 160) : '';
  } catch (err) {
    return '';
  }
}

/** The signed-in user's GitHub session. Forge stores and refreshes the token. */
export function userClient() {
  return api.asUser().withProvider('github', 'github-api');
}

async function userGet(gh, fn, path) {
  const res = await gh.fetch(path, { headers: HEADERS });
  if (!res.ok) throw new GitHubError(fn, res.status, await detail(res));
  return res.json();
}

/** Repositories the user can reach through the GitHub App, at most `limit`. */
export async function listUserRepos(gh, limit = 300) {
  const repos = [];
  const installs = await userGet(gh, 'listUserRepos(installations)', '/user/installations?per_page=100');
  for (const inst of installs.installations || []) {
    for (let page = 1; page <= 5 && repos.length < limit; page += 1) {
      const data = await userGet(gh, `listUserRepos(installation ${inst.id})`, `/user/installations/${inst.id}/repositories?per_page=100&page=${page}`);
      for (const repo of data.repositories || []) {
        repos.push({ fullName: repo.full_name, installationId: inst.id, defaultBranch: repo.default_branch, canPush: Boolean(repo.permissions?.push) });
      }
      if ((data.repositories || []).length < 100) break;
    }
  }
  return repos.slice(0, limit);
}

/** Finds one repository in the user's list, or null. Used to re-check access before acting as the App. */
export async function findUserRepo(gh, fullName) {
  const repos = await listUserRepos(gh);
  return repos.find((repo) => repo.fullName === fullName) || null;
}

const b64url = (input) => Buffer.from(input).toString('base64url');

/** A 5-minute JWT that proves this code holds the GitHub App's private key. */
export function appJwt(now = Math.floor(Date.now() / 1000)) {
  const appId = process.env.GITHUB_APP_ID;
  const keyB64 = process.env.GITHUB_APP_PRIVATE_KEY_B64;
  if (!appId || !keyB64) throw new Error('appJwt: GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY_B64 must be set with `forge variables set`');
  const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify({ iat: now - 30, exp: now + 300, iss: String(appId) }));
  const signature = crypto.createSign('RSA-SHA256').update(`${head}.${body}`).sign(Buffer.from(keyB64, 'base64').toString('utf8'));
  return `${head}.${body}.${b64url(signature)}`;
}

/** An installation token limited to one repository and to the two permissions this app needs. */
export async function installationToken(installationId, repoName) {
  const res = await fetch(`${API}/app/installations/${installationId}/access_tokens`, {
    method: 'POST',
    headers: { ...HEADERS, Authorization: `Bearer ${appJwt()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ repositories: [repoName], permissions: { contents: 'write', pull_requests: 'read' } }),
  });
  if (!res.ok) throw new GitHubError(`installationToken(${installationId})`, res.status, await detail(res));
  return (await res.json()).token;
}

async function appCall(token, fn, method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { ...HEADERS, Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res;
}

/** Contents of `.github/jira-bot.yaml` on the default branch, or '' when the file is absent. */
export async function readRepoConfig(token, fullName) {
  const res = await appCall(token, 'readRepoConfig', 'GET', `/repos/${fullName}/contents/.github/jira-bot.yaml`);
  if (res.status === 404) return '';
  if (!res.ok) throw new GitHubError(`readRepoConfig(${fullName})`, res.status, await detail(res));
  const file = await res.json();
  return file?.content ? Buffer.from(file.content, 'base64').toString('utf8') : '';
}

/** Branch names that start with `prefix`. */
export async function matchingBranches(token, fullName, prefix) {
  const res = await appCall(token, 'matchingBranches', 'GET', `/repos/${fullName}/git/matching-refs/heads/${prefix}`);
  if (res.status === 404) return [];
  if (!res.ok) throw new GitHubError(`matchingBranches(${fullName}, ${prefix})`, res.status, await detail(res));
  return (await res.json()).map((ref) => ref.ref.replace(/^refs\/heads\//, ''));
}

/** Commit at the tip of `branch`, or null when the branch does not exist. */
export async function branchSha(token, fullName, branch) {
  const res = await appCall(token, 'branchSha', 'GET', `/repos/${fullName}/git/ref/heads/${branch}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new GitHubError(`branchSha(${fullName}, ${branch})`, res.status, await detail(res));
  return (await res.json()).object?.sha || null;
}

/** Creates `name` at `sha`. Returns 'created' or 'exists'. */
export async function createBranch(token, fullName, name, sha) {
  const res = await appCall(token, 'createBranch', 'POST', `/repos/${fullName}/git/refs`, { ref: `refs/heads/${name}`, sha });
  if (res.status === 201) return 'created';
  if (res.status === 422) return 'exists';
  throw new GitHubError(`createBranch(${fullName}, ${name})`, res.status, await detail(res));
}

/** Pull requests opened from `branch`, newest first, at most 5. */
export async function pullsForBranch(token, fullName, branch) {
  const owner = fullName.split('/')[0];
  const res = await appCall(token, 'pullsForBranch', 'GET', `/repos/${fullName}/pulls?state=all&per_page=5&head=${encodeURIComponent(`${owner}:${branch}`)}`);
  if (!res.ok) throw new GitHubError(`pullsForBranch(${fullName}, ${branch})`, res.status, await detail(res));
  return (await res.json()).map((pr) => ({ number: pr.number, title: pr.title, url: pr.html_url, state: pr.merged_at ? 'merged' : pr.state }));
}
