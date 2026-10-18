# Inspect the committed artifact, not the working copy

PromiseKeeper's documented Git condition names a repository, a path and a minimum
line count. A working-tree file is not evidence of what was committed: it may be
untracked, edited after the commit, or belong to another repository. This optional
read-only tool inspects a precisely selected committed artifact instead.

It is a review aid, separate from the existing verification and escrow CLI.
**It does not decide promise fulfillment, authorize anything, or release funds.**
Neither an exit code nor this JSON receipt should be wired to a payment decision.
It does not read or modify `promises.json`, call `verify.js` or `escrow.js`, access a
wallet, fetch a repository, or contact an API. The existing API-verification demo
still simulates success; this tool does not make that behavior real or safe.

## Example: notes committed in the agreed repository

Suppose the agreed artifact is `notes/chapters.md`, with at least 100 lines. The
reviewer chooses the intended local repository and obtains the full commit ID from
the proposed contribution. They can inspect the committed note without trusting
whatever happens to be in the working directory:

```sh
node tools/git-artifact-receipt.js \
  --repo /absolute/path/to/bob-bootstrap \
  --commit FULL_LOWERCASE_COMMIT_OBJECT_ID \
  --path notes/chapters.md \
  --min-lines 100
```

Use a complete 40-character SHA-1 or 64-character SHA-256 commit ID, not `HEAD`, a
branch, abbreviated hash, tag, or revision expression. Replace the placeholder
above with that actual ID. Relative repository paths and nested working directories
are rejected; the explicitly selected repository root is required.

The report records canonical local repository path, commit, tree, blob object ID,
file path/mode, byte length, content SHA-256 and LF-delimited line count. Re-run the
same invocation to inspect the same object even if HEAD or the working file changes.
To compare with a previously reviewed content hash, add:

```sh
--expected-sha256 FULL_LOWERCASE_CONTENT_SHA256
```

A hash obtained from the same untrusted author is an identity comparison, not
independent verification. Preserve the reviewed commit and expected digest in the
review record if they matter; the tool does not lock or authenticate that record.

The result may be `artifact_conditions_matched`, `artifact_conditions_mismatch`,
`unknown`, or `invalid_request`. In every case, promise fulfillment, authorization
and source authenticity remain `not_assessed`. No existing `PROMISE_*_COMPLETE`
or `PROMISEKEEPER_VERIFY_*_SUCCESS` signal is emitted.

Exit codes: 0 for matched artifact conditions, 1 for mismatch/unavailable/unsupported
artifact, 2 for invalid arguments. **Exit 0 is not a payment or completion decision.**
A hundred lines can be copied, irrelevant or incorrect. They do not prove that the
agent read a book, understood it, satisfied the actual request, owned the repository,
held the right permission, or worked before a deadline.

## Supported scope

- Node.js 18+, Git and a POSIX host. No npm dependencies or install.
- Existing local non-bare repository with required commit/tree/blob objects already
  available. A shallow or partial clone can return `unknown`; nothing is fetched.
- Regular files committed with mode 100644 or 100755. Symlinks, directories and
  submodules do not count. A symlink in the working tree is never followed because
  the working-tree artifact is never read.
- UTF-8 text without NUL bytes, at most 1 MiB. Invalid encoding, binary and oversized
  artifacts remain unsupported. Lines are separated by LF; a trailing LF terminates
  the last line rather than creating a phantom additional line. An empty file has
  zero lines. A UTF-8 BOM is preserved for line counting, so a BOM-only blob
  has one line. CRLF therefore counts normally; bare CR is not a line delimiter.
- Explicit repository-relative paths; no traversal, `.git` component, control
  characters, backslash, `SENSITIVE_*` or `knowledge_base` path. Shell metacharacters
  and spaces are passed literally, never interpolated into commands; Git pathspec
  magic is disabled. No arbitrary command or Git option is accepted from a manifest.

## Trust and provenance limits

The local path is the repository binding. The caller must choose the repository
agreed by the parties. This is not a remote-origin, account, author or signature
check: a local clone may contain someone else's commits, and multiple repositories
can contain exactly the same commit. Remote URLs can be spoofed and are deliberately
not treated as identity. Commit timestamps are author-controlled and are not used
as proof of completion time.

Git's object database and local repository configuration, the installed Git binary,
the caller's environment/roots and the host filesystem remain trust assumptions.
This is not a sandbox for a hostile `.git` directory or a corrupt object store, and
it does not run a full object-database integrity audit. Expected SHA-256 checks bind
the observed blob bytes when a reviewer supplies a previously trusted digest.

The CLI disables Git replacement refs, grafts, optional locks, filesystem-monitor
hooks, ordinary hooks, inherited `GIT_*` overrides, prompting and lazy fetch;
an explicit empty `GIT_ALLOW_PROTOCOL` allowlist disables all protocols as a
backstop, including when a scheme-specific local Git configuration allows one. It invokes only object-inspection commands
with bounded captured output and a five-second timeout per command. It performs
no checkout, add, commit, clone, fetch or other mutation. It does not execute files,
filters, student code, or any live agent. Do not publish the report without reviewing
its local paths and content metadata for private information. Path exclusions are
not a complete secret scanner.

## Tests

```sh
node --test test/git-artifact-receipt.test.js
```

Tests create temporary synthetic local repositories, never use the real promise
database or escrow, and never contact external services. Cases cover working-tree
and staged edits, deleted/untracked files, wrong-repository selection, explicit
commit versus refs/tags/blobs, replacement refs, path traversal, shell metacharacters,
literal Git pathspecs, symlinks/directories, exact digests, precise line counts,
invalid requests/encoding/size, CLI status and read-only worktree/index/ref behavior.

This is an additive capability. Existing `verify.js`, financial flows, lifecycle
signals and the smart contract are unchanged and are not certified by these tests.
