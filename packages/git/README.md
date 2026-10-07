# @yaks/git

Builds Git objects out of a file manifest, stores them as graph entities, and
serves `git clone` and authorized pushes over Git's smart HTTP protocol.
`@yaks/git/host` tracks checkouts on an explicitly supplied machine, and
`@yaks/git/land` checks or rebases the caller's checkout before asking the graph
to accept its commit.

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
- `@yaks/git/host`: local checkout discovery, and creating, taking back and
  re-creating worktrees, using the `git` subprocess.
- `@yaks/git/service`: while a process is up, takes back the idle worktrees that
  hold nothing, in every repository the graph knows.
- `@yaks/git/land`: branch checks and rebase through a supplied `Run`, with
  commit acceptance supplied by the caller.
- `@yaks/git/receive`: pack verification, object import and guarded branch
  acceptance on a supplied decoder machine.
- `@yaks/git/routes`: opt-in authenticated clone and push endpoints for a
  configured list of graph repositories.
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
import { graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { edgeDoc, edgeKeywords, edges } from '@yaks/edge'
import { keyDoc, keyKeywords, keys } from '@yaks/key'
import { address, encode, memoryBlobs } from '@yaks/blob'
import { gitDoc, index } from '@yaks/git'

let vocab = loadVocab([edgeDoc, keyDoc, gitDoc], [edgeKeywords, keyKeywords])
let plugins = [edges(vocab), keys(vocab)]
let g = graph({ storage: ram(vocab), vocab, plugins })

// Two files already in the byte store, named by their SHA-256.
let store = memoryBlobs()
let put = (text: string) => {
  store.put(address(text), encode(text))
  return address(text)
}
let sha = put('<h1>Hello</h1>\n')
let other = put('export let hello = 1\n')
let deployedAt = '2026-09-25T12:00:00Z'

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

head.oid // the Git object id, 40 hex digits, and the entity id
head.oid256 // the same commit's SHA-256 object id
```

Writing the same manifest again produces the same ids, which are the same rows:
an object is stored once no matter how many versions, apps or runs mention it.

## Four consequences

- **An object's entity id is its Git object id.** There is no `sha` property, no
  uniqueness constraint and nothing to reconcile: a `want` line in a fetch
  request is a lookup by primary key.
- **Each object built from a manifest also has a SHA-256 object id.** `oid256`
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
file{path, repository}                 a file in a repository, identified by both
```

A `commit` stores the whole commit message, not just its first line, and its
entity id is the commit sha — so recording the same commit twice produces one
entity, and it carries no `sha` property that could disagree with its own id.

## Citations

A document that quotes code goes out of date when the code moves, and nothing
says so. A **citation** is that reference written down: an edge `A cites B`,
where `B` is a `file` entity for a place in code, a [@yaks/code](../code)
`symbol` for a definition, and any entity at all otherwise.

```
cites{hash?}               @yaks/kernel relation: A refers to B; a graph
                           target's verified content hash
revision{commit}           the commit it was last checked against
lines{start, end}          the line range it names, when it names one
quote{text}                what the citing side quoted
verified{at, by, via}      @yaks/kernel's mark: somebody checked and it holds
```

Each fact is a component of its own because each is independent: a citation may
name a line range or not, and the commit moves under all of them. A definition
is cited by pointing at its `symbol` entity, which survives the file moving
around it. Writing the same citation twice writes one entity, because an edge's
id is derived from `from | cites | to` ([@yaks/edge](../edge)).

For a file or symbol, currentness is derived from Git by asking which commits
after `revision.commit` touched the place the citation names. For any other
entity, [@yaks/kernel](../kernel) compares its content with the hash recorded
when the citation was verified. Server stamps do not affect that hash. Editing
the cited content leaves the old mark and hash in place, so the citation reads
moved until checked again.

`@yaks/git/cites` derives that answer: `status(cite, file, { cwd })` reads the
checkout at `cwd` and says one of

```
{ state: 'current' }
{ state: 'moved', changes: ['b8b0f89'] }   what moved under it
{ state: 'unverified' }                    nobody has checked it yet
{ state: 'unknown', why: '…' }             nothing could establish an answer
```

The question put to Git is `git log <revision.commit>..HEAD`, narrowed to
`-L :<symbol.name>:<path>` when it points at a definition (the path is its
module's) or `-L <lines.start>,<lines.end>:<path>` when it names lines, so a
commit elsewhere in the same file is not reported. The commit is checked with
`cat-file` first: one this checkout does not have — rebased away, or from
another clone — reads `unknown`, never `current`.

A citation of an entity uses the kernel's `status(cite, target, vocab)` and
needs no checkout or journal. An older verified edge without a content hash
reads `unknown` until it is verified again.

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

`verify` writes `verified{}` and, for a file or symbol, `revision{commit}` for
the commit the checkout is on. For another entity it records `cites.hash` from
the cited content. The mark is written empty because `at`, `by` and `via` are
the graph's to stamp.

Load the components beside the two packages whose mechanisms they use:

```ts
import { graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { edgeDoc, edgeKeywords, edges } from '@yaks/edge'
import { keyDoc, keyKeywords, keys } from '@yaks/key'
import { kernelDoc } from '@yaks/kernel'
import { gitDoc } from '@yaks/git'

let vocab = loadVocab([kernelDoc, edgeDoc, keyDoc, gitDoc], [
  edgeKeywords,
  keyKeywords,
])
let storage = ram(vocab)
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
import { graph, mint } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { edgeDoc, edgeKeywords, edges } from '@yaks/edge'
import { keyDoc, keyKeywords, keys } from '@yaks/key'
import { address, encode, memoryBlobs } from '@yaks/blob'
import { commitOnto, gitDoc, refAt, refDoc } from '@yaks/git'

// The branches in one graph, the objects in another, their bytes in a store.
let refVocab = loadVocab([refDoc])
let refs = graph({ storage: ram(refVocab), vocab: refVocab })
let vocab = loadVocab([edgeDoc, keyDoc, gitDoc], [edgeKeywords, keyKeywords])
let plugins = [edges(vocab), keys(vocab)]
let objects = graph({ storage: ram(vocab), vocab, plugins })
let bytes = memoryBlobs()
bytes.put(address('<h1>Hello</h1>\n'), encode('<h1>Hello</h1>\n'))

let repo = { refs, objects, bytes }
let app = mint()
let who = { name: 'Build Service', email: 'build@example.com', at: 0 }

let head = await commitOnto(repo, {
  app,
  files: { 'index.html': address('<h1>Hello</h1>\n') },
  author: who,
  committer: who,
  message: 'deploy 7\n',
})

await refAt(repo.refs, app) // head.oid
```

That writes every object and points the branch at the new commit. A **bundle**
is one entity's components represented as a JSON object. An optional `beside`
returns bundles about the commit —
`(oids) => [{ entity: { eid: oids.oid },
made: { release } }]` — that are
submitted with the ref update as one **batch**, a list of bundles applied in one
transaction. This package declares no component joining a commit to its
application input, because that input depends on the application; `beside` is
where the caller supplies those rows. The parent commit is read from the ref
rather than passed in, so a commit written the moment a release landed and a
commit written later by a repair pass end up on the same chain.

The same step is also available as a graph plugin, hooked on the `effect` phase:

```ts
import type { Bundle } from '@yaks/graph'
import { commits, type Released } from '@yaks/git'

declare let alreadyCommitted: (b: Bundle) => boolean
declare let landingFor: (b: Bundle) => Promise<Released>

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

`objects(g, store)` reads the objects a graph and byte store hold:
`reach([head.oid])` is every object a clone of `head` needs, and
`pack([head.oid], have)` is the same as a v2 packfile, streaming.

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
import type { Graph } from '@yaks/graph'
import type { Blobs } from '@yaks/blob'
import { advertise, objects, uploadPack } from '@yaks/git'

// One repository's two doors: the graph and byte store holding its objects,
// and the commit its main branch points at.
let repository = (g: Graph, store: Blobs, main: string) => {
  let refs = { list: async () => [{ name: 'refs/heads/main', oid: main }] }
  return (req: Request) =>
    req.method == 'GET'
      ? advertise(req) // <repo>/info/refs?service=git-upload-pack
      : uploadPack(req, refs, objects(g, store)) // <repo>/git-upload-pack
}
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

`@yaks/git/land` checks the caller's checkout through a supplied **Run**, a
function that executes Git on that checkout's machine and returns its exit
status and raw output. The caller supplies `cwd`, `run`, `base` (a fetched
revision ref or SHA), and `accept`, an async callback that accepts the checked
HEAD. A successful invocation returns `{ landed: sha, root: cwd }` only after
`accept` completes. Standalone clones and linked worktrees are both supported.

This example needs a prepared checkout and a receiver, so it is not run as a
doctest:

```ts ignore
import { land, type Run } from '@yaks/git/land'

declare const run: Run // Git on the caller's machine
// Fetch base objects before land; accept imports the pack and guards the ref.
declare const base: string
declare const accept: (head: string) => Promise<void>
declare const refresh: () => Promise<string>

const outcome = await land({
  cwd: '/workspace/project',
  run,
  base,
  accept,
  refresh,
})
if ('diverged' in outcome) {
  // Resolve any conflict, rerun tests, and invoke land again.
}
```

`land` refuses a dirty checkout, detached HEAD or the base branch itself. It
checks whether `base` is an ancestor of HEAD. If not, it rebases onto `base` and
returns `{ diverged: true, conflict }` without calling `accept`, leaving a
conflicting rebase for the caller to resolve. No test suite runs here.

If acceptance loses a compare-and-set, the optional `refresh` callback fetches
and returns the latest base. A changed base makes `land` rebase and stop, not
retry acceptance on untested code. With no `refresh`, or an unchanged base, the
acceptance error remains a fault. Every Git command runs at the supplied `cwd`;
landing does not merge into another checkout, update its index, unlock worktrees
or publish to an upstream. The graph-backed tool can publish the already
accepted SHA to the base branch’s configured upstream; a failed publication is
reported as pending and does not undo graph acceptance.

Before acceptance, `reverts` detects a rebase that restores earlier base
content. It finds files changed by `base...HEAD` that no branch commit touched,
and added lines whose content appeared earlier at the same path in base history.
Either condition refuses the landing and reports the files, the diff, and the
override flag. Only added lines can restore old content; a hunk that only
removes lines is treated as a deletion. `allow` names deliberate exceptions.

`@yaks/git/tools` supplies the graph and machine integration for `yak land`:

```sh
yak land                          # ask the graph to accept this checkout's HEAD
yak land --allow-revert=a.ts,b.ts # accept those files' deliberate rewind
```

### Clone, push and land on a supplied machine

The HTTP host opts into clone and push endpoints through `@yaks/git/routes`. Its
`repositories` option maps a simple URL slug to a graph repository entity id. An
empty mapping exposes no routes. The mapping is an access boundary: every
authenticated caller of this host may read and fast-forward-write every mapped
repository. It is not a per-repository permission list. Both reads and writes
require an actor from `host.who`; an unauthenticated request returns 401.

For example, a host plugin config can opt into one repository:

```json
{
  "use": "@yaks/git",
  "with": { "repositories": { "project": "repository-entity-id" } }
}
```

That mapping exposes exactly `/git/project.git/info/refs`,
`/git/project.git/git-upload-pack` and `/git/project.git/git-receive-pack`. Each
push uses a fresh sandbox from the host's default machine provider and releases
it in `finally`; it does not borrow a caller checkout or the graph host's
filesystem. Received object and ref writes are signed as the authenticated
actor. The following example assumes this mount and the host's authentication
are configured.

This example needs a lent machine with Git and `yak`, a repository whose read
and write access has already been configured, and an existing commit to push. It
is not run as a doctest:

```ts ignore
import type { Machine } from '@yaks/machine'

declare const machine: Machine // Explicitly lent by the host or provider.
// The host maps the slug project to the graph repository entity.
const endpoint = 'https://git.example.test/git/project.git'
const cwd = '/workspace/project'
const exec = async (command: string, directory?: string) => {
  const id = await machine.start(command, directory)
  for (;;) {
    const process = await machine.look(id)
    if (!process) throw new Error('process disappeared')
    if (process.exit) {
      if (process.exit.code !== 0) throw new Error('command failed')
      return
    }
    await new Promise((resolve) => setTimeout(resolve, machine.poll ?? 100))
  }
}

await exec(`git clone ${endpoint} ${cwd}`)
await exec('git checkout -b work', cwd)
// The caller edits and commits on this machine, then runs the relevant tests.
// A direct push exports Git's pack to the authorized receiver:
await exec('git push origin HEAD:refs/heads/review', cwd)
// Graph landing checks against the accepted main of this named repository:
await exec('yak land --repository project --branch refs/heads/main', cwd)
```

`--repository` names the graph repository entity, not its URL slug or the
machine's Git directory. In this example, `project` must resolve to that entity
in the graph. `--branch` selects its accepted branch. Push an initial base
before landing a named repository. The graph-backed tool fetches the accepted
base's objects, exports the candidate pack, and calls the receiver on the
supplied machine. An explicitly attached legacy checkout can supply a repository
identity and bootstrap its base once; a local ref observation cannot replace a
newer accepted graph ref. Catch-up of an attached checkout is separate from
commit acceptance.

### Receiving a commit

`@yaks/git/receive` verifies a pack in an isolated scratch repository on a
supplied decoder machine. `acceptPack` takes the repository, the application id,
branch, observed old commit, proposed commit and pack bytes. It validates object
hashes, closure and fast-forward ancestry before importing raw object bodies and
their graph edges. A guarded `ref.commit` write accepts the commit; a stale
observation refuses instead of overwriting another accepted commit. Imported
immutable objects may remain after a lost compare-and-set, but a verification
failure never advances the branch. Receive supports SHA-1 Git objects only and
preserves exact incoming object bytes, including signed commits. It does not
manufacture SHA-256 compatibility objects or `compat` keys for received objects.
The byte store's SHA-256 address is not a Git SHA-256 object id.

`advertiseReceive` and `receivePack` implement the receive-pack HTTP protocol. A
custom HTTP mount must authorize repository writes before calling them;
`@yaks/git/routes` provides the opt-in authenticated mount described above. They
accept one branch update per request, never deletes or forced updates. Pack
decoding acquires no checkout or implicit host filesystem: the host supplies its
decoder machine explicitly.

## What is not implemented

The outgoing pack has no delta compression, shallow clone or negotiation — a
`have` is subtraction, so a client that is still negotiating is answered `NAK`
and gets its pack once it sends `done`. There is one branch per `ref` row, and
nothing here walks a reflog. And nothing here writes a row joining a commit to
the thing it was built from: those rows are the application's, written through
`beside` alongside the moved ref.

`crypto.subtle` and `CompressionStream` let the object-building and clone code
run on a server, in a worker and in a browser tab. Checkout and pack-decoding
operations additionally need an explicitly supplied machine with Git; the local
`run` adapter in `@yaks/git/land` needs Deno.

## Checkouts on one machine

A **machine** is an explicitly lent command and file capability
(`@yaks/machine`), not the process that serves the graph. `@yaks/git/host` adds
`discover`, `checkoutAt`, `createWorktree`, `holds`, `reclaim`, `lost`,
`idleFor`, `linked`, `locate`, `reconcile`, `restore`, `processCwds`,
`processPaths`, `sync` and `inUse`. Operations that read or change checkout
files require a trailing `Machine` argument rather than acquiring the graph
host's filesystem. `sync` takes its options after the machine. The machine needs
Git, Bash and Python for these operations. They are kept out of the main entry
point, which still type-checks with only the web platform in scope. Load
`checkoutDoc` to get just the four components below — `repository`, `worktree`,
`ref` and `checkout` — without the Git object components.

Git is authoritative for checkout observations; discovery records those
observations without changing checkout files. A graph branch with received
objects remains authoritative for accepted commits: discovery does not overwrite
its accepted ref with a local observation.

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
  will keep once it exists. Discovery refreshes unreceived local refs when it is
  called; it does not replace accepted graph refs or import commit bodies into
  the graph.
- `checkout` records the intent to create a worktree, stored on the entity that
  worktree will have: the requested base, the commit that base resolved to, the
  branch, how far preparation got, and the error if it failed. Creation is
  serialized per path within the process, and across processes by an advisory
  lock file in the repository, which the kernel releases if a process dies. A
  retry reconciles the case where Git succeeded but the graph was not updated.
  When Git fails, the intent row stays visible; preparation does not select a
  different checkout.

This example needs a graph and an explicitly supplied machine with the source
checkout already present, so it is not run as a doctest:

```ts ignore
import { createWorktree, discover, holds } from '@yaks/git/host'
import type { Graph } from '@yaks/graph'
import type { Machine } from '@yaks/machine'

declare const graph: Graph
declare const machine: Machine
await discover(graph, '/workspace/project', machine)
await createWorktree(graph, '/workspace/project', {
  path: '/workspace/work',
  branch: 'work',
}, machine)
const kept = await holds('/workspace/work', 'refs/heads/main', machine)
```

Creating a worktree defaults to a detached HEAD at the source checkout's
committed HEAD. Uncommitted files in the source are not copied, committed, reset
or stashed. Passing a short branch name creates a new branch instead. An
existing checkout has to be discovered and attached explicitly; creation refuses
to adopt a directory that is already there. Nothing is merged, pruned or deleted
automatically the moment an agent finishes. A managed directory that has gone
missing is an error, not permission to recreate it and lose whatever was
uncommitted in it.

Taking a worktree back is a separate, explicit step.
`holds(path, undefined, machine)` says what a worktree still holds: `dirty` for
uncommitted files, `unlanded` when its HEAD is on no branch but its own (a path
that is not a checkout counts as that too), or nothing.
`reclaim(path, undefined, machine)` removes a worktree and the branch it was
created on only when it holds nothing, and never with `--force`, so Git's own
refusal stands behind that test; it returns what kept it, `failed` included.
Pass a full local branch ref as the second argument to `holds` or `reclaim` to
require landing there: `reclaim(path, "refs/heads/main", machine)`. The branch
reflog must also prove the branch committed work still contained in HEAD; a
fresh branch, a branch only fast-forwarded from main, or missing evidence keeps
the checkout. This also keeps a worktree whose gitdir Git has lost
(`lost(path, machine)`), because neither its cleanliness nor its landing can be
proved. Without a required landing, lost worktrees are deleted outright.
`restore(g, row, machine)` creates a worktree again at the path, branch and
commit its row recorded, so run `discover` on it before taking it back.
`linked(common, machine)` names a repository's linked worktrees, and
`idleFor(path, Date.now(), machine)` says how long since Git last wrote one's
HEAD, index or reflog.

### Catching up an attached checkout

`sync(graph, path, machine, { bytes, app, branch })` mirrors an accepted graph
branch into one explicitly attached checkout. `app` defaults to that checkout's
repository entity; `branch` defaults to `refs/heads/main`. It imports the
accepted objects and fast-forwards only a clean checkout already on that branch.
Its result is `synced`, `current`, `dirty`, `diverged` or `missing`. Dirty files
and divergent history stay intact. Sync never advances a graph ref and does not
reset, clean or force a checkout.

This example needs the graph's byte store and an attached checkout:

```ts ignore
import { sync } from '@yaks/git/host'
import type { Graph } from '@yaks/graph'
import type { Blobs } from '@yaks/blob'
import type { Machine } from '@yaks/machine'

declare const graph: Graph
declare const bytes: Blobs
declare const machine: Machine
const state = await sync(graph, '/workspace/project', machine, {
  bytes,
  app: 'project',
  branch: 'refs/heads/main',
})
// A dirty or diverged result is work to resolve, not a failed acceptance.
```

`processPaths(undefined, machine)` reads the working directories and open file
paths of this user's live Linux processes. An unreadable process path refuses
collection, so agents outside the graph also keep their worktrees. Non-dumpable
processes require a privileged read through a root-owned helper, launched by the
systemd user manager. The helper returns a JSON array of the cwd and absolute
open file paths, accepts one positive PID and checks that it belongs to the sudo
caller. Install it from this package as root:

```sh
install -D -o root -g root -m 0755 packages/git/process-cwd.py /usr/local/libexec/yak-process-cwd
```

Grant the collecting user passwordless sudo for exactly that helper, with a
trailing `*` for its argument. For a user named `collector`, the sudoers entry
is `collector ALL=(root) NOPASSWD: /usr/local/libexec/yak-process-cwd *`. The
helper refuses additional arguments, other users' processes and path traversal.
Enable the user's systemd manager with `loginctl enable-linger
collector`.
Collection retains every checkout if the helper or manager fails, including an
installed helper that still returns only a cwd. `processCwds(machine)` remains
available for callers needing only directories.

`@yaks/git/service` is the caller for every worktree nobody else takes back.
Once an hour it runs `collect` on each repository the graph knows that is on
this machine: every linked worktree Git has left alone for six hours and that is
clean and has committed work landed on main is reclaimed once no live graph
session or local process uses it. A `managed` worktree is left to its owner, not
collected here. The service requires an explicitly lent `host.machines.local`;
without it the service does nothing. It can also catch up attached clean
checkouts to their accepted graph branch when the host supplies the byte store.
Accepted refs are checked every second; an unchanged accepted commit runs no
machine command. Dirty or divergent checkouts are reported and retried after 30
seconds; collection still runs once an hour. The `idle` and `every` options
change the two durations.

`locate(cwd, machine)` reads the canonical checkout root, common Git directory
and worktree Git directory without writing to the graph. It returns no
observation when the directory is missing or is not a checkout; other failures
remain errors. `reconcile(g, common, machine)` removes the `worktree` component
from missing unmanaged checkouts in that repository, keeping their entities and
other components. Managed rows retain the history `restore` needs. The service
reconciles each repository before collecting its idle worktrees.

Identity and locking assume one filesystem and one shared graph, used by
cooperating processes on that machine. A checkout moved on disk, or changed by
Git outside this package, is noticed the next time discovery runs; the service
reconciles missing unmanaged checkouts on each pass.

## Reading a commit's source paths

`@yaks/git/source` exports `treeAt(cwd, commit, paths)`, a map of regular-file
paths to their Git blob ids. It accepts a full object id, verifies it as a
commit, uses literal repository-relative paths and leaves unknown revisions,
symlinks and submodules unresolved. It never reads the checkout's files.
`rootsOf(common)` lists the repository's primary and linked checkout roots
without pruning or changing Git state.
