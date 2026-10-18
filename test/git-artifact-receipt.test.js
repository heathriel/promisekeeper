'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { inspect } = require('../tools/git-artifact-receipt.js');
const cli = path.join(__dirname, '../tools/git-artifact-receipt.js');

function git(repo, args, input) {
  const result = spawnSync('git', ['-C', repo, ...args], {
    encoding: 'utf8', input, env: { ...process.env, GIT_CONFIG_NOSYSTEM:'1', GIT_CONFIG_GLOBAL:'/dev/null',
      GIT_AUTHOR_NAME:'Synthetic Fixture', GIT_AUTHOR_EMAIL:'fixture@example.invalid',
      GIT_COMMITTER_NAME:'Synthetic Fixture', GIT_COMMITTER_EMAIL:'fixture@example.invalid',
      GIT_AUTHOR_DATE:'2026-01-01T00:00:00Z', GIT_COMMITTER_DATE:'2026-01-01T00:00:00Z' }
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}
function fixture(t, name = 'notes.md', bytes = 'first\nsecond\n') {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'receipt-fixture-'));
  t.after(() => fs.rmSync(repo, { recursive:true, force:true }));
  git(repo,['init','-q']);
  fs.writeFileSync(path.join(repo,name),bytes);
  git(repo,['add','--',name]); git(repo,['commit','-qm','Synthetic fixture']);
  const commit = git(repo,['rev-parse','HEAD']);
  return { repo, commit, path:name, minLines:2 };
}
function run(options) {
  return spawnSync(process.execPath,[cli,'--repo',options.repo,'--commit',options.commit,
    '--path',options.path,'--min-lines',String(options.minLines),
    ...(options.expectedSha256 ? ['--expected-sha256',options.expectedSha256] : [])],{encoding:'utf8',timeout:10000});
}

test('receipt binds explicit repo commit tree blob path and SHA-256',t=>{
  const opts=fixture(t); const r=inspect(opts);
  assert.equal(r.status,'artifact_conditions_matched');
  assert.equal(r.repository,fs.realpathSync(opts.repo));assert.equal(r.commit,opts.commit);
  assert.equal(r.tree,git(opts.repo,['rev-parse','HEAD^{tree}']));
  assert.equal(r.blob,git(opts.repo,['rev-parse','HEAD:notes.md']));
  assert.equal(r.sha256,crypto.createHash('sha256').update('first\nsecond\n').digest('hex'));
  assert.equal(r.line_count,2);assert.equal(r.promise_fulfillment,'not_assessed');
  assert.equal(r.authorization,'not_assessed');assert.equal(r.source_authenticity,'not_assessed');
});
test('working-tree edits and deletion cannot replace committed contents',t=>{
  const opts=fixture(t);const original=inspect(opts);
  fs.writeFileSync(path.join(opts.repo,opts.path),'uncommitted\n'.repeat(100));
  assert.deepEqual(inspect(opts),original);
  fs.unlinkSync(path.join(opts.repo,opts.path));assert.deepEqual(inspect(opts),original);
});
test('staged edits do not replace selected commit',t=>{
  const opts=fixture(t);fs.writeFileSync(path.join(opts.repo,opts.path),'uncommitted\n'.repeat(100));
  git(opts.repo,['add','notes.md']);assert.equal(inspect(opts).line_count,2);
});
test('untracked file cannot satisfy commit condition',t=>{
  const opts=fixture(t);fs.writeFileSync(path.join(opts.repo,'untracked.md'),'some notes\n');
  assert.throws(()=>inspect({...opts,path:'untracked.md'}));
});
test('selected repo used regardless current working directory',t=>{
  const one=fixture(t);const two=fixture(t,'notes.md','different\nnotes\nhere\n');
  assert.equal(inspect(one).line_count,2);assert.equal(inspect(two).line_count,3);
  assert.throws(()=>inspect({...two,commit:one.commit}));
});
test('repo subdirectories rejected rather than silently using parent repo',t=>{
  const opts=fixture(t);fs.mkdirSync(path.join(opts.repo,'nested'));
  assert.throws(()=>inspect({...opts,repo:path.join(opts.repo,'nested')}));
});
test('full commit is required, refs and revision expressions rejected',t=>{
  const opts=fixture(t);
  for(const commit of ['HEAD','main',opts.commit.slice(0,7),`${opts.commit}:notes.md`,'--help'])assert.throws(()=>inspect({...opts,commit}));
});
test('blob and tag IDs cannot masquerade as commits',t=>{
  const opts=fixture(t);const blob=git(opts.repo,['rev-parse','HEAD:notes.md']);
  assert.throws(()=>inspect({...opts,commit:blob}));
  git(opts.repo,['tag','-a','demo','-m','Synthetic tag']);const tag=git(opts.repo,['rev-parse','demo']);
  assert.throws(()=>inspect({...opts,commit:tag}));
});
test('path traversal and controls rejected',t=>{
  const opts=fixture(t);
  for(const file of ['../notes.md','/etc/passwd','a/../notes.md','./notes.md','a//b','a\\b','a\nb','.git/config','SENSITIVE_notes','knowledge_base/notes'])assert.throws(()=>inspect({...opts,path:file}));
});
test('shell metacharacters and spaces are literal filenames',t=>{
  const name='notes $(touch INJECTED); "quote".md';const opts=fixture(t,name);
  assert.equal(inspect(opts).path,name);assert.equal(fs.existsSync(path.join(opts.repo,'INJECTED')),false);
});
test('Git pathspec syntax is literal, never a wildcard',t=>{
  const opts=fixture(t,':(glob)*.md');assert.equal(inspect(opts).path,':(glob)*.md');
  assert.throws(()=>inspect({...opts,path:'*'}));
});
test('symlink and directory committed entries rejected',t=>{
  const opts=fixture(t);fs.symlinkSync('notes.md',path.join(opts.repo,'link'));
  fs.mkdirSync(path.join(opts.repo,'dir'));fs.writeFileSync(path.join(opts.repo,'dir','x'),'x');
  git(opts.repo,['add','.']);git(opts.repo,['commit','-qm','Add synthetic entries']);
  const commit=git(opts.repo,['rev-parse','HEAD']);
  assert.throws(()=>inspect({...opts,commit,path:'link'}));assert.throws(()=>inspect({...opts,commit,path:'dir'}));
});
test('minimum-line mismatch remains a mismatch',t=>{
  const opts=fixture(t);const r=inspect({...opts,minLines:3});
  assert.equal(r.status,'artifact_conditions_mismatch');assert.equal(r.conditions.minimum_lines,false);
});
test('expected SHA-256 mismatch is explicit',t=>{
  const opts=fixture(t);assert.equal(inspect({...opts,expectedSha256:'0'.repeat(64)}).status,'artifact_conditions_mismatch');
  assert.equal(inspect({...opts,expectedSha256:inspect(opts).sha256}).status,'artifact_conditions_matched');
});
test('line counts do not add a phantom trailing line',t=>{
  for(const [text,count] of [['',0],['one',1],['one\n',1],['one\r\ntwo\r\n',2],['\n',1]]){
    const opts=fixture(t,'notes.md',text);assert.equal(inspect(opts).line_count,count);
  }
});
test('UTF-8 BOM counts as text rather than disappearing before LF counting',t=>{
  for(const [text,count] of [['\ufeff',1],['\ufeff\n',1],['\ufefffirst\nsecond',2]]){
    const opts=fixture(t,'notes.md',text);assert.equal(inspect(opts).line_count,count);
  }
});
test('network protocol allowlist is explicitly empty despite inherited overrides',t=>{
  const source=fs.readFileSync(cli,'utf8');
  assert.match(source,/GIT_ALLOW_PROTOCOL: ''/);
  assert.match(source,/GIT_NO_LAZY_FETCH: '1'/);
});
test('invalid minimums cannot silently disable check',t=>{
  const opts=fixture(t);for(const minLines of [0,-1,1.5,NaN,Infinity,'2',1048577])assert.throws(()=>inspect({...opts,minLines}));
});
test('binary invalid UTF-8 and oversized blobs rejected',t=>{
  for(const bytes of [Buffer.from([255]),Buffer.from([0]),Buffer.alloc(1048577,65)]){
    const opts=fixture(t,'notes.md',bytes);assert.throws(()=>inspect(opts));
  }
});
test('replace refs cannot change the selected original commit',t=>{
  const opts=fixture(t);const old=inspect(opts);fs.writeFileSync(path.join(opts.repo,'notes.md'),'replacement\n'.repeat(5));
  git(opts.repo,['add','.']);git(opts.repo,['commit','-qm','Replacement fixture']);
  const newer=git(opts.repo,['rev-parse','HEAD']);git(opts.repo,['replace',opts.commit,newer]);
  assert.deepEqual(inspect(opts),old);
});
test('CLI returns narrow receipt without completion or release signals',t=>{
  const opts=fixture(t);const result=run(opts);assert.equal(result.status,0,result.stderr);
  assert.equal(JSON.parse(result.stdout).promise_fulfillment,'not_assessed');
  assert.doesNotMatch(result.stdout,/PROMISE_.*_COMPLETE|PROMISEKEEPER_VERIFY_.*_SUCCESS/);
  assert.equal(run({...opts,minLines:3}).status,1);
  assert.equal(run({...opts,commit:'HEAD'}).status,2);
  const missing=run({...opts,path:'missing'});assert.equal(missing.status,1);assert.equal(JSON.parse(missing.stdout).status,'unknown');
});
test('read-only inspection leaves worktree index and refs unchanged',t=>{
  const opts=fixture(t);
  const before={status:git(opts.repo,['status','--porcelain']),refs:git(opts.repo,['show-ref']),index:fs.readFileSync(path.join(opts.repo,'.git/index')).toString('hex')};
  inspect(opts);
  const after={status:git(opts.repo,['status','--porcelain']),refs:git(opts.repo,['show-ref']),index:fs.readFileSync(path.join(opts.repo,'.git/index')).toString('hex')};
  assert.deepEqual(after,before);
});
