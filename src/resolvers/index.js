// Resolver for the issue panel and the get-started page.
// This file replaces the Connect app's Sinatra server: routes became resolver functions,
// the cookie session became Forge storage, and the GitHub OAuth handshake moved into Forge external auth.
import Resolver from '@forge/resolver';
import { kvs } from '@forge/kvs';
import {
  userClient, listUserRepos, findUserRepo, installationToken, readRepoConfig,
  matchingBranches, branchSha, createBranch, pullsForBranch, GitHubError,
} from '../lib/github.js';
import { parseConfig, planBranch, needsCustomName, branchPrefixes, branchBelongsToIssue } from '../lib/branching.js';

const resolver = new Resolver();

const selectionKey = (accountId, projectId) => `selection:${accountId}:${projectId}`;
const repoUrl = (fullName) => `https://github.com/${fullName}`;
const branchUrl = (fullName, branch) => `${repoUrl(fullName)}/tree/${branch.split('/').map(encodeURIComponent).join('/')}`;
const installUrl = () => `https://github.com/apps/${process.env.GITHUB_APP_SLUG || ''}/installations/new`;

/** Paid listings carry a license in production. Development and staging have none, and are let through. */
function licensed(context) {
  if (context.environmentType !== 'PRODUCTION') return true;
  const license = context.license;
  if (!license) return true; // free listing or not listed
  return Boolean(license.active ?? license.isActive);
}

function issueContext(context) {
  const issueKey = context.extension?.issue?.key;
  const projectId = context.extension?.project?.id;
  if (!issueKey || !projectId) throw new Error('issueContext: this panel only works on an issue');
  return { issueKey, projectId, accountId: context.accountId };
}

/** Opens the GitHub sign-in when the user has not connected yet. Forge shows the consent prompt and stops the call. */
async function signedInClient() {
  const gh = userClient();
  if (!(await gh.hasCredentials())) await gh.requestCredentials();
  return gh;
}

function friendly(err, fn) {
  console.error(`${fn} failed:`, err?.message || err);
  if (err instanceof GitHubError && err.status === 401) return 'GitHub rejected the request. Reconnect GitHub from your Atlassian account settings, under Connected apps.';
  if (err instanceof GitHubError && err.status === 403) return 'GitHub refused this action. Check that the GitHub App is installed on the repository.';
  if (err instanceof GitHubError && err.status === 404) return 'GitHub could not find that repository or branch.';
  return 'Something went wrong talking to GitHub. Try again.';
}

async function branchesForIssue(token, fullName, issueKey) {
  const found = new Set();
  for (const prefix of branchPrefixes(issueKey)) {
    for (const branch of await matchingBranches(token, fullName, prefix)) {
      if (branchBelongsToIssue(branch, issueKey)) found.add(branch);
    }
  }
  const branches = [];
  for (const name of [...found].slice(0, 5)) {
    branches.push({ name, url: branchUrl(fullName, name), pulls: await pullsForBranch(token, fullName, name) });
  }
  return branches;
}

resolver.define('getState', async ({ context }) => {
  if (!licensed(context)) return { view: 'unlicensed' };
  const { issueKey, projectId, accountId } = issueContext(context);
  const gh = await signedInClient();
  let selection = null;
  try {
    selection = await kvs.get(selectionKey(accountId, projectId));
    if (!selection) {
      const repos = await listUserRepos(gh);
      if (repos.length === 0) return { view: 'install', installUrl: installUrl() };
      return { view: 'choose', issueKey, repos: repos.map((repo) => repo.fullName), installUrl: installUrl() };
    }
    const repoName = selection.fullName.split('/')[1];
    const token = await installationToken(selection.installationId, repoName);
    const branches = await branchesForIssue(token, selection.fullName, issueKey);
    const config = { branchPattern: selection.branchPattern, baseBranch: selection.baseBranch };
    return {
      view: branches.length > 0 ? 'linked' : 'create',
      issueKey,
      repo: selection.fullName,
      repoUrl: repoUrl(selection.fullName),
      branches,
      asksForName: needsCustomName(config),
      preview: needsCustomName(config) ? null : planBranch({ issueKey, config, defaultBranch: selection.defaultBranch }),
    };
  } catch (err) {
    // A saved repository can go away (renamed, moved, or the GitHub App removed). Let the user pick again.
    return { view: 'error', message: friendly(err, 'getState'), canChooseAgain: Boolean(selection) };
  }
});

resolver.define('selectRepo', async ({ payload, context }) => {
  const { projectId, accountId } = issueContext(context);
  const gh = await signedInClient();
  try {
    const repo = await findUserRepo(gh, String(payload?.fullName || ''));
    if (!repo) return { ok: false, message: 'That repository is not available to your GitHub account through the GitHub App.' };
    const token = await installationToken(repo.installationId, repo.fullName.split('/')[1]);
    const config = parseConfig(await readRepoConfig(token, repo.fullName));
    await kvs.set(selectionKey(accountId, projectId), {
      fullName: repo.fullName, installationId: repo.installationId, defaultBranch: repo.defaultBranch,
      branchPattern: config.branchPattern, baseBranch: config.baseBranch, savedAt: new Date().toISOString(),
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, message: friendly(err, 'selectRepo') };
  }
});

resolver.define('clearRepo', async ({ context }) => {
  const { projectId, accountId } = issueContext(context);
  await kvs.delete(selectionKey(accountId, projectId));
  return { ok: true };
});

resolver.define('createBranch', async ({ payload, context }) => {
  if (!licensed(context)) return { ok: false, message: 'This app has no active license on this site.' };
  const { issueKey, projectId, accountId } = issueContext(context);
  const gh = await signedInClient();
  try {
    const selection = await kvs.get(selectionKey(accountId, projectId));
    if (!selection) return { ok: false, message: 'Choose a repository first.' };
    // The branch is created by the GitHub App, so check the person asking may push there themselves.
    const repo = await findUserRepo(gh, selection.fullName);
    if (!repo) return { ok: false, message: 'Your GitHub account no longer has access to this repository.' };
    if (!repo.canPush) return { ok: false, message: 'Your GitHub account cannot push to this repository.' };
    const config = { branchPattern: selection.branchPattern, baseBranch: selection.baseBranch };
    let plan;
    try {
      plan = planBranch({ issueKey, config, defaultBranch: repo.defaultBranch, customName: payload?.customName });
    } catch (err) {
      return { ok: false, message: 'Enter a branch name using letters, numbers, dots, dashes or underscores.' };
    }
    const token = await installationToken(repo.installationId, repo.fullName.split('/')[1]);
    const sha = await branchSha(token, repo.fullName, plan.base);
    if (!sha) return { ok: false, message: `The base branch "${plan.base}" does not exist in ${repo.fullName}.` };
    const outcome = await createBranch(token, repo.fullName, plan.name, sha);
    return { ok: true, outcome, name: plan.name, base: plan.base, url: branchUrl(repo.fullName, plan.name) };
  } catch (err) {
    return { ok: false, message: friendly(err, 'createBranch') };
  }
});

resolver.define('getStarted', async () => ({ installUrl: installUrl() }));

export const handler = resolver.getDefinitions();
