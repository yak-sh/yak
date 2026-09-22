# @yaks/git

Builds Git objects out of a file manifest, stores them as graph entities, and
serves `git clone` over Git's read-only smart HTTP protocol. A second entry
point, `@yaks/git/host`, tracks the Git checkouts on the machine it runs on, and
a third, `@yaks/git/land`, merges a branch in one of them.

The package separates Git object bytes from the graph data used to find and walk
them. File, tree, and commit bodies live in an `@yaks/blob` store. Graph
entities hold object type, size, byte-store address, tree entries, commit
parents, and refs.

## Install

```sh
deno add jsr:@yaks/git
# or: npx jsr add @yaks/git
```

Entry points:

- `@yaks/git`: object builders and storage, refs, packfiles, smart HTTP, and the
  commit plugin.
- `@yaks/git/host`: local checkout discovery and worktree creation using the
  `git` subprocess.
- `@yaks/git/land`: the filesystem-based branch landing operation.
- `@yaks/git/cites`: how a citation stands against the code it names, derived
  from Git.
- `@yaks/git/tools`: graph-tool implementations — `land`, `cites check` and
  `cites verify`.
- `@yaks/git/vocab`: vocabulary documents without runtime behavior.

## The idea

A file manifest maps `path → sha256` for bytes already in an
[@yaks/blob](https://jsr.io/@yaks/blob) store. Git describes the same set of
files as blobs, trees and a commit, and names each of those by the digest of its
own bytes. So the object id is the entity id, and no separate lookup is needed:

```ts
import { index } from '@yaks/git'

let git = index(g, store)

let tree = await git.files({ 'index.html': sha, 'lib/app.js': other })
let head = await git.commit({
  tree,
  author: { name: 'Example User', email: 'user@example.com', at: deployedAt },
  committer: {
    name: 'Build Service',
    email: 'build@example.com',
    at: deployedAt,
  },
  message: 'deploy 7',
})

head.oid // '2b72ae1c151a…' — the Git object id, and the entity id
head.oid256 // the same commit's SHA-256 object id
```

Writing the same manifest again produces the same ids, which are the same rows:
an object is stored once no matter how many versions, apps or runs mention it.

## Four consequences

- **An object's entity id is its Git object id.** There is no `sha` column, no
  uniqueness constraint and nothing to reconcile: a `want` line in a fetch
  request is a lookup by primary key.
- **Every object also has a SHA-256 object id, from the first write.** `oid256`
  is the same object with its children's ids translated, stored as an @yaks/key
  of kind `compat` (Git's term for the id under the other hash function). The
  current HTTP server advertises and serves SHA-1 repositories only; the
  compatibility key is available to storage and application code.
- **Object bodies and traversal data use separate storage.** A tree or commit
  body is stored unchanged in the byte store because Git hashes those bytes. The
  graph stores `gitobj{type, size}`, `blob{sha}`, and the relations needed for
  traversal: `tree_entry` (tree → child, with the name on the relation) and
  `parent` (commit → commit).
- **A Git blob is the blob you already have.** The bytes are already in the
  store under their SHA-256 address; the Git object is those same bytes with a
  header hashed over them. Nothing is re-encoded, and naming the same file twice
  costs one query and no read of the bytes.

## The components

```
gitobj{type, size}       one Git object — entity id = its SHA-1 object id
blob{sha}                where its bytes are, in the @yaks/blob store
tree_entry{name, mode}   @yaks/edge relation: a tree holds a child under a name
parent                   @yaks/edge relation: a commit follows a commit
compat                   @yaks/key kind: the same object's SHA-256 object id
ref{app, name, commit}   where one branch of one repository points
```

The tree-to-child relation is called `tree_entry` rather than `entry` because
@yaks/session already declares an `entry` component for a transcript line.

`@yaks/git/vocab` exports these declarations on their own, with no storage and
no runtime behind them, for code that only needs to read the schema.

Components for source code, as the rest of a graph refers to it:

```
repository{common, origin}             a local object database, and its remote
worktree{repository, path, branch,…}   a checkout: where it is, what it is on
commit{target, repo, message}          a landed commit, attached to its work
file{path, repository}                 a file in a repository, as an entity
```

A `commit` stores the whole commit message, not just its first line, and its
entity id is the commit sha — so recording the same commit twice produces one
entity, and it carries no `sha` column that could disagree with its own id.

## Citations

A document that quotes code goes out of date when the code moves, and nothing
says so. A **citation** is that reference written down: an edge `A cites B`,
where `B` is a `file` entity for a place in code and any entity at all
otherwise.

```
cites                      @yaks/edge relation: A refers to a place in B
revision{commit}           the commit it was last checked against
symbol{name}               the definition it names, when it names one
lines{start, end}          the line range it names, when no definition fits
quote{text}                what the citing side quoted
verified{at, by, via}      @yaks/kernel's mark: somebody checked and it holds
```

Each fact is a component of its own because each is independent: a citation may
name a definition, a line range or neither, and the commit moves under all of
them. Writing the same citation twice writes one entity, because an edge's id is
derived from `from | cites | to` ([@yaks/edge](../edge)).

Whether a citation is still current is never stored: it is derived from Git, by
asking which commits after `revision.commit` touched the place the citation
names. `verified` is the one thing that is stored, and only the act of checking
writes it — editing either end of a citation leaves the mark where it was, so a
typo fixed in a document cannot pass for a citation somebody checked.

`@yaks/git/cites` derives that answer:

```ts
import { status } from '@yaks/git/cites'

await status(cite, file, { cwd: '/home/me/project' })
// { state: 'current' }
// { state: 'moved', changes: ['b8b0f89'] }   what moved under it
// { state: 'unverified' }                    nobody has checked it yet
// { state: 'unknown', why: '…' }             nothing could establish an answer
```

The question put to Git is `git log <revision.commit>..HEAD`, narrowed to
`-L :<symbol.name>:<path>` or `-L <lines.start>,<lines.end>:<path>` when the
citation named a place, so a commit elsewhere in the same file is not reported.
The commit is checked with `cat-file` first: one this checkout does not have —
rebased away, or from another clone — reads `unknown`, never `current`.

A citation of an entity rather than a file asks the same question of the
journal: what changed about that entity after `verified.at`. That is the
`changed` seam in `Ops`, which a host fills from [@yaks/journal](../journal)'s
`entries`; without one, a citation of an entity reads `unknown` rather than
guessing.

## Checking and verifying citations

`@yaks/git/tools` puts the two verbs on the command line, reading the checkout
the command runs in:

```sh
yak cites check                  # every citation that moved or was never checked
yak cites check D-37775          # …only the ones that record makes
yak cites check --path=src/db.ts # …only citations of one file
yak cites verify <citation>      # checked and it holds: mark it, at this commit
yak cites verify --of=D-37775    # …every citation that record makes
```

`check` is a health check — a tool whose verb is `check`
([@yaks/tools](../tools/README.md#health-checks)) — so a citation that moved is
a `fail` finding, one nobody has checked and one nothing could establish an
answer for are `warn`, and a run with nothing to report still answers. It
enforces nothing: a document whose code moved is work somebody has to do, not a
transaction to reject.

`verify` writes `verified{}` and `revision{commit}` for the commit the checkout
is on, in one transaction, as the caller. The mark is written empty because
`at`, `by` and `via` are the graph's to stamp — so a citation records who
checked it and when, and nothing else writes that.

Load the components beside the two packages whose mechanisms they use:

```ts
import { loadVocab } from '@yaks/vocab'
import { edgeDoc, edgeKeywords, edges } from '@yaks/edge'
import { keyDoc, keyKeywords, keys } from '@yaks/key'
import { gitDoc } from '@yaks/git'

let vocab = loadVocab([edgeDoc, keyDoc, gitDoc], [edgeKeywords, keyKeywords])
let g = graph({ storage, vocab, plugins: [edges(vocab), keys(vocab)] })
```

A `tree_entry` entity id is derived from the string `tree_entry|<tree>|<name>`
rather than from @yaks/edge's usual `from|relation|to`, because two names in one
tree may point at the same blob; within a tree, the name is unique. A `ref`
entity id is derived from `ref|<app>|<name>`, so moving a branch updates the row
that is already there.

Objects are global — an object is the digest of its own bytes, so the same file
in two repositories is one row — while a branch belongs to exactly one
repository. A server that decides read access per repository therefore keeps its
refs in the graph where that decision is made and its objects in a store of
their own, loading `refDoc` in the first and `gitDoc` in the second.

## A branch, and landing a release on it

```ts
import { commitOnto, refAt } from '@yaks/git'

let repo = { refs: g, objects: objectGraph, bytes: store }

let head = await commitOnto(repo, {
  app,
  files: { 'index.html': sha },
  author,
  committer,
  message: 'deploy 7\n',
  beside: (oids) => [{ entity: { eid: oids.oid }, made: { release } }],
})

await refAt(repo.refs, app) // head.oid
```

That writes every object, points the branch at the new commit, and writes
whatever the caller wants recorded about that commit. A **bundle** is one
entity's components represented as a JSON object. `beside` returns bundles that
are submitted with the ref update as one **batch**, a list of changes applied in
one transaction. This package declares no component joining a commit to its
application input, because that input depends on the application; `beside` is
where the caller supplies those rows. The parent commit is read from the ref
rather than passed in, so a commit written the moment a release landed and a
commit written later by a repair pass end up on the same chain.

The same step is also available as a graph plugin, hooked on the `effect` phase:

```ts
import { commits } from '@yaks/git'

let plugin = commits({
  comp: 'deploy',
  of: async (b, tx) => alreadyCommitted(b) ? null : landingFor(b),
})
```

Everything specific to the application's release model — what a release is
called, where its manifest is, who authored it, which graphs and byte store hold
its objects and branches, and whether it has been committed already — is
answered by that one `of` function. An application with its own post-commit hook
registry can register `minting(…)` directly; the plugin adds the graph phase
registration.

## A clone is a packfile

```ts
import { objects } from '@yaks/git'

let from = objects(g, store)

await from.reach([head.oid]) // every object it needs, each once
await from.pack([head.oid], have) // …as a v2 packfile, streaming
```

`reach` returns each reachable object once. It follows `parent` edges for
history and `tree_entry` edges for reachability. A commit's own tree is read
from the first line of its body, which is the one link no row carries.

A `have` line is handled by subtraction, not by negotiation: everything the
client reports it already holds is walked first, so those objects are simply
absent from the answer, and a `have` naming an object this graph never held is
ignored.

`pack` writes `PACK`, version 2, the object count, then each object's
type-and-size varint followed by its zlib-deflated body, then the SHA-1 of every
byte before it. Every object is stored whole rather than as a delta, which the
format permits. The entry header contains the uncompressed size, and the body
uses zlib through `CompressionStream('deflate')`, rather than raw deflate. The
pack is streamed; `./sha1.ts` updates the trailer digest as bytes pass, so only
one object's body is held in memory at a time.

## The byte-level builders

The builders do not touch a graph at all, and each one is tested against the
bytes Git itself produced for the same input:

```ts
import { commitBody, DIR, FILE, oid, oid256, treeBody } from '@yaks/git'

const fileOid = await oid('blob', new TextEncoder().encode('hello\n'))
// 'ce013625030ba8dba906f756967f9e9ca394464a'

const treeOid = await oid('tree', new Uint8Array())
treeBody([
  { name: 'a.txt', mode: FILE, oid: fileOid },
  { name: 'a', mode: DIR, oid: treeOid },
])
// a.txt sorts first: a directory sorts as though its name ended in `/`
```

A directory's mode is `40000` in the body, without the leading zero printed by
`git ls-tree` as `040000`. Directories sort as `name + '/'`, compared over UTF-8
bytes.

## Serving a clone over HTTP

```ts
import { advertise, uploadPack } from '@yaks/git'

let refs = { list: async () => [{ name: 'refs/heads/main', oid: head.oid }] }

// GET  <repo>/info/refs?service=git-upload-pack
advertise(req)
// POST <repo>/git-upload-pack
await uploadPack(req, refs, objects(g, store))
```

This is Git's smart HTTP protocol, version 2, read-only. The response to the
`GET` advertises what this server supports and lists no refs at all — that is
what version 2 changed, and `ls-refs` is the command a client sends to get them.
The `fetch` command is answered with a packfile, side-band framed as version 2
requires, holding everything the `want` lines reach minus everything the `have`
lines reach.

Only what is implemented is advertised: `ls-refs`, `fetch`, `object-format=sha1`
and `server-option`. A client that is never told about shallow clones,
partial-clone filters or SHA-256 packs never asks for them. A `want` for an
object that no ref reaches is refused with an `ERR` line — the same rule as
Git's `uploadpack.allowAnySHA1InWant=false` — because serving an object to
whoever guesses its id would publish something nobody published.

The module does no routing: which repository a URL names, and who is allowed to
read it, belong to whatever mounts these two handlers. yaks.app mounts an app's
deploy history at `<app>.git` and responds to a request for the app's own
address — the URL you would type in a browser — with a 301 redirect to it, so
either address can be cloned:

```sh
git clone https://ada.yaks.app/recipes/
git clone https://ada.yaks.app/recipes.git   # where the first one lands
```

The query string is what distinguishes a clone from a page request:
`?service=git-upload-pack` is something no browser sends, and Git follows that
first redirect and fetches from where it landed.

For a private repository, the server that mounts these handlers must
authenticate the request and check access before calling them. HTTP Basic
authentication is what prompts a Git client for credentials; validating the
credentials is that server's job.

## Landing a branch

`@yaks/git/land` is a plain Git operation with no graph in it, and
`@yaks/git/tools` exposes that operation as a tool, so `yak land` works in a Git
checkout. The CLI opens the configured graph and merges the checkout at the
current working directory in the same process.

```sh
yak land                            # fast-forward this branch into the base
yak land --allow-revert=a.ts,b.ts   # …and accept those files' rewind
```

Every coordinate comes from Git alone: the primary worktree is the shared
checkout to merge into, and the branch that checkout has checked out is the
base. One invocation does at most one of two things: fast-forward the branch
into the base and push if the base has an upstream; or, if the base moved,
rebase onto it and return without merging, printing the incorporated diff so the
caller can rerun tests and land again. The `--ff-only` merge is the
compare-and-swap that serializes concurrent landers. No test suite is run here,
and this operation knows of none.

Before the fast-forward, `reverts` detects a rebase that restores earlier base
content. It finds files changed by `base...HEAD` that no branch commit touched,
and added lines whose content appeared earlier at the same path in base history.
Either condition refuses the landing and reports the files, the diff, and the
override flag. Only added lines can restore old content; a hunk that only
removes lines is treated as a deletion.

`land` operates on the filesystem rather than on the graph: the checkout at
`ctx.cwd`, which the caller supplies and which on a command line is the
directory the person ran the command in. A diverged base comes back as a
refusal, so the exit code tells you whether anything landed.

## What is not implemented

There is no `git-receive-pack` service, so nothing can be pushed to this server;
there is also no delta compression, no shallow clone and no negotiation — a
`have` is subtraction, so a client that is still negotiating is answered `NAK`
and gets its pack once it sends `done`. There is one branch per `ref` row, and
nothing here walks a reflog. And nothing here writes a row joining a commit to
the thing it was built from: those rows are the application's, written through
`beside` alongside the moved ref.

`crypto.subtle` and `CompressionStream` are the only platform APIs used, so the
same code runs on a server, in a worker and in a browser tab — and because both
are async, writing an object is async too.

## Checkouts on one machine

Here a **host** is the process that opened the graph and runs these operations.
`@yaks/git/host` adds `discover`, `checkoutAt`, and `createWorktree`, which run
`git` as a subprocess and therefore need Deno. They are kept out of the main
entry point, which still type-checks with only the web platform in scope. Load
`checkoutDoc` to get just the four components below — `repository`, `worktree`,
`ref` and `checkout` — without the Git object components.

Git is authoritative here; the graph holds an observation of it that can be
refreshed at any time without changing anything.

- `repository{common}` identifies a local object database by its canonical
  common Git directory. Independent clones are different repositories.
- `worktree{repository,path,gitdir,head,branch,managed}` is a checkout. Its
  entity id is derived from the repository plus the canonical checkout root
  path, so the branch and head can change without changing its identity, and
  paths that differ only by a symlink resolve to the same entity. Moving a
  checkout gives it a new identity; this deliberately avoids depending on Git's
  linked-worktree administrative directory names, which Git may reuse. These
  identities are local to one machine, not portable between clones.
- The existing `ref{app,name,commit}` component is reused: `app` may name the
  repository entity, and `refEid(repository, fullName)` stays stable as the
  branch moves. Observing a repository on this machine adds `oid` (the raw
  target, which for an annotated tag is the tag object), `target` (the full name
  a symbolic ref points at) and `present`. A deleted ref is marked absent rather
  than deleted, so recreating it reuses the same entity. There is no separate
  branch component competing with `ref`.
- HEAD belongs to each worktree: `head` is its resolved object id, and `branch`
  names the shared ref entity, or is absent for a detached HEAD. A branch that
  has no commits yet gets a ref row marked absent, with the same stable id it
  will keep once it exists. Discovery refreshes refs when it is called; there is
  no watcher, and it does not import commit bodies into the graph.
- `checkout` records the intent to create a worktree, stored on the entity that
  worktree will have: the requested base, the commit that base resolved to, the
  branch, how far preparation got, and the error if it failed. Creation is
  serialized per path within the process, and across processes by an advisory
  lock file in the repository, which the kernel releases if a process dies. A
  retry reconciles the case where Git succeeded but the graph was not updated.
  When Git fails, the intent row stays visible; preparation does not select a
  different checkout.

Creating a worktree defaults to a detached HEAD at the source checkout's
committed HEAD. Uncommitted files in the source are not copied, committed, reset
or stashed. Passing a short branch name creates a new branch instead. An
existing checkout has to be discovered and attached explicitly; creation refuses
to adopt a directory that is already there. Nothing is merged, pruned or deleted
automatically when an agent finishes. A managed directory that has gone missing
is an error, not permission to recreate it and lose whatever was uncommitted in
it.

Identity and locking assume one filesystem and one shared graph, used by
cooperating processes on that machine. A checkout moved on disk, or changed by
Git outside this package, is noticed the next time discovery runs; there is no
background reconciliation.
