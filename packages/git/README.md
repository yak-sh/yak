# @yaks/git

Git objects as entities, for a [@yaks/graph](https://jsr.io/@yaks/graph) — so a
deploy history is a repository anybody can clone.

## Install

```sh
deno add jsr:@yaks/git
# or: npx jsr add @yaks/git
```

## The idea

A version of a yaks.app app is a manifest: `path → sha256`, over bytes already
in a [@yaks/blob](https://jsr.io/@yaks/blob) store. Git wants the same thing
said its way — blobs, trees, a commit — and every one of those is named by the
digest of its own bytes. So the object IS its id, and the id is the entity:

```ts
import { index } from '@yaks/git'

let git = index(g, store)

let tree = await git.files({ 'index.html': sha, 'lib/app.js': other })
let head = await git.commit({
  tree,
  author: { name: 'ada', email: 'ada@users.yaks.app', at: deployedAt },
  committer: { name: 'yaks.app', email: 'git@yaks.app', at: deployedAt },
  message: 'deploy 7',
})

head.oid // '2b72ae1c151a…' — git's name, and the entity's eid
head.oid256 // the same commit's SHA-256 name
```

Writing the same manifest again writes the same ids, which are the same rows: an
object is stored once however many versions, apps or runs mention it.

## Four things follow

- **An object's entity id is its object id.** No `sha` column, no uniqueness
  constraint, no reconciliation — a `want` off the wire is a `get`.
- **Every object has a SHA-256 name too, from the first day.** `oid256` is the
  same object with its children translated, kept as a @yaks/key of kind `compat`
  (git's own word for the name in the other hash function). A client asking for
  `object-format=sha256` is answered by a lookup, never a migration.
- **Bodies are bytes; rows are walks.** The body of a tree or a commit is what
  its digest was taken over, so it goes to the byte store verbatim and the graph
  keeps only `gitobj{type, size}`, `blob{sha}`, and the two walks a pack makes:
  `entry` edges (tree → child, the name on the link) and `parent` edges.
- **A git blob is your blob.** The bytes are already stored under their SHA-256;
  the object is a header hashed over them. Nothing is re-encoded, and a file
  named twice costs a query and no read.

## The vocabulary

```
gitobj{type, size}   one git object — eid = its SHA-1 object id
blob{sha}            where its bytes are, in the @yaks/blob store
entry{name, mode}    @yaks/edge relation: a tree holds a child under a name
parent               @yaks/edge relation: a commit follows a commit
compat               @yaks/key kind: the same object's SHA-256 name
```

Load it beside the two carriers it uses:

```ts
import { loadVocab } from '@yaks/vocab'
import { edgeDoc, edgeKeywords, edges } from '@yaks/edge'
import { keyDoc, keyKeywords, keys } from '@yaks/key'
import { gitDoc } from '@yaks/git'

let vocab = loadVocab([edgeDoc, keyDoc, gitDoc], [edgeKeywords, keyKeywords])
let g = graph({ storage, vocab, plugins: [edges(vocab), keys(vocab)] })
```

An `entry` is named `sha256("entry|<tree>|<name>")` rather than by @yaks/edge's
own sentence, because two names in one tree may point at one blob — within a
tree the NAME is what is unique.

## The bytes, on their own

The builders are independent of any graph, and each is checked against what git
itself produced for the same input:

```ts
import { commitBody, DIR, FILE, oid, oid256, treeBody } from '@yaks/git'

await oid('blob', new TextEncoder().encode('hello\n'))
// 'ce013625030ba8dba906f756967f9e9ca394464a'

treeBody([{ name: 'a.txt', mode: FILE, oid }, { name: 'a', mode: DIR, oid: t }])
// a.txt FIRST: a directory sorts as though its name ended in `/`
```

Two details are the whole of the tree format, and both are where a hand-written
one usually goes wrong: a directory's mode is `40000` in the body (no leading
zero, unlike `git ls-tree`'s printing), and a directory sorts as `name + '/'`,
over UTF-8 bytes.

## What is not here

No pack format, no HTTP, no ref: this package writes objects. It also writes no
`commit{target}` row — joining a commit to the deploy it was minted from belongs
to whoever mints it, on the same entity.

`crypto.subtle` is the one platform API, so the same code runs on a server, in a
worker and in a browser tab — and because it is async, so is writing an object.
