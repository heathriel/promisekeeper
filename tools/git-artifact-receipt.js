#!/usr/bin/env node
'use strict';

// Optional read-only evidence aid. Never evaluates promises or releases funds.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { TextDecoder } = require('node:util');
const LIMIT = 1024 * 1024;

function gitEnvironment() {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
  Object.assign(env, {
    GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_NO_REPLACE_OBJECTS: '1', GIT_NO_LAZY_FETCH: '1', GIT_ALLOW_PROTOCOL: '',
    GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', GIT_GRAFT_FILE: '/dev/null'
  });
  return env;
}

function git(repo, args) {
  const run = spawnSync('git', ['--no-optional-locks', '--literal-pathspecs',
    '-c', 'protocol.allow=never', '-c', 'core.fsmonitor=false',
    '-c', 'core.hooksPath=/dev/null', '-C', repo, ...args], {
    env: gitEnvironment(), encoding: null, maxBuffer: LIMIT + 4096,
    timeout: 5000, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true
  });
  if (run.error || run.status !== 0) throw new Error('Git object unavailable or repository unsupported');
  return run.stdout;
}

function validate(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw new Error('Invalid options');
  const allowed = new Set(['repo', 'commit', 'path', 'minLines', 'expectedSha256']);
  if (Object.keys(options).some(key => !allowed.has(key))) throw new Error('Unknown option');
  if (typeof options.repo !== 'string' || !path.isAbsolute(options.repo)) throw new Error('repo must be an absolute local repository root');
  if (typeof options.commit !== 'string' || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(options.commit)) throw new Error('commit must be a full lowercase object ID, not a ref');
  if (typeof options.path !== 'string' || !options.path || options.path.startsWith('/') || /[\\\x00-\x1f\x7f]/.test(options.path)
      || options.path.split('/').some(p => !p || p === '.' || p === '..' || p.toLowerCase() === '.git'
        || p.startsWith('SENSITIVE_') || p === 'knowledge_base')) throw new Error('path must be a safe repository-relative artifact path');
  if (!Number.isSafeInteger(options.minLines) || options.minLines < 1 || options.minLines > LIMIT) throw new Error('min-lines must be an integer from 1 to 1048576');
  if (options.expectedSha256 !== undefined && (typeof options.expectedSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(options.expectedSha256))) throw new Error('expected-sha256 must be a lowercase SHA-256');
}

function inspect(options) {
  validate(options);
  const repo = fs.realpathSync(options.repo);
  const gitRoot = fs.realpathSync(git(repo, ['rev-parse', '--show-toplevel']).toString('utf8').replace(/\n$/, ''));
  if (gitRoot !== repo) throw new Error('repo must identify the repository root, not a nested working directory');
  if (git(repo, ['cat-file', '-t', options.commit]).toString('ascii').trim() !== 'commit') throw new Error('object ID must identify a commit, not a tag/tree/blob');
  const tree = git(repo, ['rev-parse', `${options.commit}^{tree}`]).toString('ascii').trim();
  const listing = git(repo, ['ls-tree', '-z', options.commit, '--', options.path]);
  const entries = listing.toString('utf8').split('\0').filter(Boolean);
  if (entries.length !== 1) throw new Error('artifact absent or ambiguous at the selected commit');
  const entry = /^(100644|100755) blob ([0-9a-f]{40}|[0-9a-f]{64})\t([\s\S]+)$/.exec(entries[0]);
  if (!entry || entry[3] !== options.path) throw new Error('artifact must be a regular committed file, not a directory, symlink or submodule');
  const size = Number(git(repo, ['cat-file', '-s', entry[2]]).toString('ascii').trim());
  if (!Number.isSafeInteger(size) || size < 0 || size > LIMIT) throw new Error('artifact exceeds 1 MiB limit');
  const bytes = git(repo, ['cat-file', 'blob', entry[2]]);
  if (bytes.length !== size) throw new Error('artifact size changed during observation');
  const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  if (text.includes('\0')) throw new Error('artifact must be UTF-8 text without NUL bytes');
  // LF-delimited logical lines; a trailing LF terminates the final line, not an extra one.
  const lineCount = text.length === 0 ? 0 : text.split('\n').length - Number(text.endsWith('\n'));
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  const conditions = { minimum_lines: lineCount >= options.minLines,
    expected_sha256: options.expectedSha256 === undefined ? 'not_requested' : sha256 === options.expectedSha256 };
  return {
    version: 1, scope: 'committed local artifact only',
    repository: repo, commit: options.commit, tree, blob: entry[2], path: options.path,
    mode: entry[1], bytes: size, sha256, line_count: lineCount,
    requested: { min_lines: options.minLines, expected_sha256: options.expectedSha256 || null },
    conditions, status: Object.values(conditions).includes(false) ? 'artifact_conditions_mismatch' : 'artifact_conditions_matched',
    promise_fulfillment: 'not_assessed', authorization: 'not_assessed',
    source_authenticity: 'not_assessed',
    note: 'Local repository selection and committed text conditions do not establish remote ownership, authorship, creation time, reading comprehension, or permission to release funds.'
  };
}

function main(argv = process.argv.slice(2)) {
  const flags = { '--repo': 'repo', '--commit': 'commit', '--path': 'path', '--min-lines': 'minLines', '--expected-sha256': 'expectedSha256' };
  try {
    const options = {};
    for (let index = 0; index < argv.length; index += 2) {
      const key = flags[argv[index]], value = argv[index + 1];
      if (!key || value === undefined || Object.hasOwn(options, key)) throw new Error('Unknown, duplicate, or missing option');
      if (key === 'minLines' && !/^[1-9][0-9]*$/.test(value)) throw new Error('min-lines must be a positive integer');
      options[key] = key === 'minLines' ? Number(value) : value;
    }
    validate(options);
    let receipt;
    try { receipt = inspect(options); }
    catch {
      console.log(JSON.stringify({ status: 'unknown', reason: 'Repository or artifact unavailable, unsupported, unsafe, or malformed',
        promise_fulfillment: 'not_assessed', authorization: 'not_assessed', source_authenticity: 'not_assessed' }, null, 2));
      return 1;
    }
    console.log(JSON.stringify(receipt, null, 2));
    return receipt.status === 'artifact_conditions_matched' ? 0 : 1;
  } catch (error) {
    console.log(JSON.stringify({ status: 'invalid_request', reason: error.message,
      promise_fulfillment: 'not_assessed', authorization: 'not_assessed', source_authenticity: 'not_assessed' }, null, 2));
    return 2;
  }
}

if (require.main === module) process.exitCode = main();
module.exports = { inspect, main, validate };
