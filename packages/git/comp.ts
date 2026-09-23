// The components this package ships, as a vocabulary document to load beside
// your own.
//
//   gitobj{type, size}      one Git object; its entity id is its SHA-1 object id
//   blob{sha}               where its bytes are, in the @yaks/blob store
//   tree_entry{name, mode}  an @yaks/edge relation: a tree holds a child
//   parent                  an @yaks/edge relation: a commit follows a commit
//   compat                  an @yaks/key kind: the same object's SHA-256 id
//   ref{app, name, commit}  where one branch of one repository points
//   file{path, repository}  a file in a repository, as an entity
//   cites                   an @yaks/edge relation: a citation of a place
//   revision{commit}        the commit a citation was last checked against
//   lines{start, end}       the line range a citation names
//   quote{text}             what the citing side quoted
//
// The document itself is ./vocab.json — plain JSON Schema, readable by
// anything that reads JSON. This file re-exports it under the names callers
// use, and keeps the explanation of why it is shaped this way.
//
// The entity ID is the object ID. `gitobj` declares no `sha` property, because
// the entity's own id is that value: an object written twice is one row
// without anyone declaring a uniqueness constraint, and a `want` line arriving
// in a fetch request is a lookup by id rather than a query. It is the same
// trick @yaks/edge and @yaks/key play with a derived id — here the derivation
// is Git's.
//
// `tree_entry` And `parent` are edges, not properties, because they are the two
// sets of links a pack has to follow: parents for history, entries for
// reachability. Everything else about a tree or a commit is in the body bytes,
// which is where the digest that names the object was taken — a property for
// the author or the message would be a second copy that nothing keeps in step.
//
// A `ref` IS A row, one per repository and branch name ({@link refEid}), and
// the only component here that is not about an object. Objects form one global
// set — an object is named by the digest of its own bytes, so the same file in
// two repositories is one row — while a branch belongs to exactly one
// repository. That is why {@link refDoc} is the same declaration published on
// its own: a server that keeps its refs in the graph where it decides access,
// and its objects in a store of their own, loads one document in each.
//
// A citation is an edge, and each fact about it is a component of its own on
// that edge: `cites` says the link is a citation, `revision{commit}` says which
// commit it was last checked against, `lines{start, end}` narrows it to one
// place in the cited file, and `quote{text}` keeps what was quoted. They are
// separate because they are independent: a citation may name a line range or
// not, and the commit moves under both. A definition is not a property here: it
// is a @yaks/code `symbol` entity, and a citation of one points at it. Whether
// a citation is still current is never stored — it is re-derived from Git, or
// from the journal for a citation of an entity (./cites.ts) — and the one thing
// that is stored is the kernel's `verified{at, by, via}` mark, written by the
// act of checking. The cited file is an entity of its own, `file{path,
// repository}`, so a citation is an ordinary link between two entities rather
// than a path property somewhere.
//
// `compat` Is A key, not a property on `gitobj`, so the reverse lookup — a
// SHA-256 `want` arriving at a SHA-1 graph — is a lookup by derived id rather
// than an index someone has to remember to declare. Same mechanism as
// @yaks/alias's names. It is named `compat`, Git's own term for the object id
// under the other hash function, rather than `oid256`, because a component
// name in the query grammar must be letters (@yaks/query `SEG`): a component
// nobody can name in a query is a component nobody can read back.

import { CORE_URI, type VocabDoc } from '@yaks/vocab'
import doc from './vocab.json' with { type: 'json' }

/** The component naming a Git object: what it is, and how long its body is. */
export let GITOBJ = 'gitobj'

/** The component naming where an object's bytes are. */
export let BLOB = 'blob'

/** The relation tag on a tree's link to a child. Named with Git's own two
 * words for it, because `entry` on its own is a transcript line in
 * @yaks/session. */
export let TREE_ENTRY = 'tree_entry'

/** The relation tag on a commit's link to the commit it follows. */
export let PARENT = 'parent'

/** The key kind an object's SHA-256 object id is stored under. Git calls an
 * object's id under the other hash function its compat oid. */
export let COMPAT = 'compat'

/** The component recording where one branch of one repository points. */
export let REF = 'ref'

// The citation components are named in ./cites.ts, beside the code that reads
// them: `file` as a component and `FILE` as a tree entry's mode (./tree.ts)
// are two different things, and this module's names are re-exported from
// ./mod.ts where they would collide.

/**
 * This package's components as a vocabulary document, to load beside
 * @yaks/edge's and @yaks/key's:
 * `loadVocab([edgeDoc, keyDoc, gitDoc], [edgeKeywords, keyKeywords])`.
 */
export let gitDoc: VocabDoc = doc

/**
 * The `ref` component alone, for the graph that keeps a repository's branches
 * when that is not the graph its objects are in. It is the same declaration,
 * so the name means one thing in both.
 */
export let refDoc: VocabDoc = {
  $vocabulary: { [CORE_URI]: true },
  title: doc.title,
  $defs: { ref: doc.$defs.ref },
}
