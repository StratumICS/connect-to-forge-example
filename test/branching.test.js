import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseConfig, planBranch, slugifyCustomName, isValidBranchName, needsCustomName, branchBelongsToIssue, PATTERN,
} from '../src/lib/branching.js';

test('parseConfig: empty, malformed and unknown values fall back to the default', () => {
  assert.deepEqual(parseConfig(''), { branchPattern: 0, baseBranch: null });
  assert.deepEqual(parseConfig(null), { branchPattern: 0, baseBranch: null });
  assert.deepEqual(parseConfig('::: not yaml: ['), { branchPattern: 0, baseBranch: null });
  assert.deepEqual(parseConfig('branch_pattern: 9'), { branchPattern: 0, baseBranch: null });
  assert.deepEqual(parseConfig("default_base_branch_name: 'evil; rm -rf'"), { branchPattern: 0, baseBranch: null });
  assert.deepEqual(parseConfig('just a string'), { branchPattern: 0, baseBranch: null });
});

test('parseConfig: documented settings', () => {
  assert.deepEqual(parseConfig('branch_pattern: 1'), { branchPattern: PATTERN.GITFLOW, baseBranch: null });
  assert.deepEqual(parseConfig('branch_pattern: 2\n'), { branchPattern: PATTERN.CUSTOM, baseBranch: null });
  assert.deepEqual(parseConfig("branch_pattern: 3\ndefault_base_branch_name: 'develop'"), { branchPattern: 3, baseBranch: 'develop' });
  assert.deepEqual(parseConfig("default_base_branch_name: 'dev'"), { branchPattern: 0, baseBranch: 'dev' });
});

test('planBranch: default pattern uses the issue key off the default branch', () => {
  assert.deepEqual(planBranch({ issueKey: 'SENG-1234', config: parseConfig(''), defaultBranch: 'main' }), { name: 'SENG-1234', base: 'main' });
});

test('planBranch: GitFlow creates feature/KEY off develop', () => {
  assert.deepEqual(planBranch({ issueKey: 'SENG-1234', config: parseConfig('branch_pattern: 1'), defaultBranch: 'main' }), { name: 'feature/SENG-1234', base: 'develop' });
});

test('planBranch: custom name is KEY/slug off the default branch and is required', () => {
  const config = parseConfig('branch_pattern: 2');
  assert.deepEqual(planBranch({ issueKey: 'SENG-1234', config, defaultBranch: 'main', customName: 'My great feature!' }), { name: 'SENG-1234/my-great-feature', base: 'main' });
  assert.throws(() => planBranch({ issueKey: 'SENG-1234', config, defaultBranch: 'main', customName: '   ' }), /asks for a branch name/);
});

test('planBranch: custom base branch applies to every pattern', () => {
  assert.deepEqual(planBranch({ issueKey: 'AB-1', config: parseConfig("default_base_branch_name: 'dev'"), defaultBranch: 'main' }), { name: 'AB-1', base: 'dev' });
  assert.deepEqual(planBranch({ issueKey: 'AB-1', config: parseConfig("branch_pattern: 3\ndefault_base_branch_name: 'release'"), defaultBranch: 'main', customName: 'x' }), { name: 'feature/AB-1/x', base: 'release' });
  assert.deepEqual(planBranch({ issueKey: 'AB-1', config: parseConfig('branch_pattern: 3'), defaultBranch: 'main' }), { name: 'feature/AB-1', base: 'develop' });
});

test('planBranch: rejects anything that is not an issue key', () => {
  for (const bad of ['', 'abc-1', 'ABC', 'ABC-', '../etc', 'ABC-1; rm', undefined]) {
    assert.throws(() => planBranch({ issueKey: bad, config: parseConfig(''), defaultBranch: 'main' }), /not an issue key/);
  }
});

test('slugifyCustomName and isValidBranchName', () => {
  assert.equal(slugifyCustomName('  Fix: login/redirect ~ loop  '), 'fix-login-redirect-loop');
  assert.equal(slugifyCustomName('..hidden..'), 'hidden');
  assert.equal(slugifyCustomName('a'.repeat(200)).length, 80);
  assert.equal(slugifyCustomName('!!!'), '');
  assert.ok(isValidBranchName('feature/SENG-1/x.y_z'));
  for (const bad of ['a b', 'a..b', 'a/', '/a', 'a.lock', 'a/.b', 'a~b', 'a^b', 'a:b', 'a?b', 'a*b', 'a[b', 'a\\b', 'a@{b', 'a//b', '']) {
    assert.equal(isValidBranchName(bad), false, bad);
  }
});

test('needsCustomName and branchBelongsToIssue', () => {
  assert.equal(needsCustomName(parseConfig('branch_pattern: 2')), true);
  assert.equal(needsCustomName(parseConfig('branch_pattern: 3')), true);
  assert.equal(needsCustomName(parseConfig('branch_pattern: 1')), false);
  assert.equal(needsCustomName(parseConfig('')), false);
  assert.ok(branchBelongsToIssue('ABC-12', 'ABC-12'));
  assert.ok(branchBelongsToIssue('ABC-12/fix', 'ABC-12'));
  assert.ok(branchBelongsToIssue('feature/ABC-12', 'ABC-12'));
  assert.ok(branchBelongsToIssue('feature/ABC-12/fix', 'ABC-12'));
  assert.equal(branchBelongsToIssue('ABC-123', 'ABC-12'), false);
  assert.equal(branchBelongsToIssue('feature/ABC-123', 'ABC-12'), false);
  assert.equal(branchBelongsToIssue('ABC-12-old', 'ABC-12'), false);
});
