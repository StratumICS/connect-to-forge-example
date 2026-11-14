// Branch naming rules, ported from the Connect app's documented behaviour (README, "Custom Branch Names").
// Pure functions: no network, no Forge APIs, so they run under node:test.
import { parse } from 'yaml';

export const APPROVED_BASE_BRANCHES = [
  'master', 'main', 'development', 'develop', 'dev', 'feature', 'hotfix', 'release', 'test', 'testing',
];

export const PATTERN = { ISSUE_KEY: 0, GITFLOW: 1, CUSTOM: 2, GITFLOW_CUSTOM: 3 };

/** Reads `.github/jira-bot.yaml`. Unknown or malformed values fall back to the default pattern. */
export function parseConfig(yamlText) {
  const config = { branchPattern: PATTERN.ISSUE_KEY, baseBranch: null };
  if (!yamlText || typeof yamlText !== 'string') return config;
  let doc;
  try {
    doc = parse(yamlText);
  } catch (err) {
    return config;
  }
  if (!doc || typeof doc !== 'object') return config;
  const pattern = Number(doc.branch_pattern);
  if ([1, 2, 3].includes(pattern)) config.branchPattern = pattern;
  const base = typeof doc.default_base_branch_name === 'string' ? doc.default_base_branch_name.trim() : '';
  if (APPROVED_BASE_BRANCHES.includes(base)) config.baseBranch = base;
  return config;
}

/** Turns free text into one git ref path segment: "My great feature!" becomes "my-great-feature". */
export function slugifyCustomName(text) {
  return String(text || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/\.{2,}/g, '.')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 80)
    .replace(/[-.]+$/g, '');
}

/** The subset of `git check-ref-format` rules that a branch name built here could break. */
export function isValidBranchName(name) {
  if (!name || name.length > 200) return false;
  if (/[\s~^:?*\[\\\x00-\x1f\x7f]/.test(name)) return false;
  if (name.includes('..') || name.includes('@{') || name.includes('//')) return false;
  if (name.startsWith('/') || name.endsWith('/') || name.endsWith('.') || name.endsWith('.lock')) return false;
  return name.split('/').every((part) => part && !part.startsWith('.') && !part.endsWith('.lock'));
}

export function needsCustomName(config) {
  return config.branchPattern === PATTERN.CUSTOM || config.branchPattern === PATTERN.GITFLOW_CUSTOM;
}

/**
 * Decides the branch to create for an issue.
 * @returns {{ name: string, base: string }}
 */
export function planBranch({ issueKey, config, defaultBranch, customName }) {
  if (!/^[A-Z][A-Z0-9_]*-\d+$/.test(issueKey || '')) throw new Error(`planBranch: not an issue key: ${issueKey}`);
  const custom = slugifyCustomName(customName);
  let name;
  let base;
  switch (config.branchPattern) {
    case PATTERN.GITFLOW:
      name = `feature/${issueKey}`;
      base = config.baseBranch || 'develop';
      break;
    case PATTERN.CUSTOM:
      if (!custom) throw new Error('planBranch: this repository asks for a branch name');
      name = `${issueKey}/${custom}`;
      base = config.baseBranch || defaultBranch;
      break;
    case PATTERN.GITFLOW_CUSTOM:
      name = custom ? `feature/${issueKey}/${custom}` : `feature/${issueKey}`;
      base = config.baseBranch || 'develop';
      break;
    default:
      name = issueKey;
      base = config.baseBranch || defaultBranch;
  }
  if (!isValidBranchName(name)) throw new Error(`planBranch: invalid branch name: ${name}`);
  return { name, base };
}

/** Ref prefixes under which a branch for this issue can live, whatever pattern made it. */
export function branchPrefixes(issueKey) {
  return [issueKey, `feature/${issueKey}`];
}

/** True when `branch` belongs to `issueKey` and not to a longer key such as ABC-12 against ABC-123. */
export function branchBelongsToIssue(branch, issueKey) {
  return branchPrefixes(issueKey).some((prefix) => branch === prefix || branch.startsWith(`${prefix}/`));
}
