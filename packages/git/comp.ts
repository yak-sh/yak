// The components this package ships, as a vocabulary document to load beside
// your own.
//
//   gitobj{type, size}   one git object, its entity id its SHA-1 object id
//   blob{sha}            where its bytes are, in the @yaks/blob store
//   entry{name, mode}    an @yaks/edge relation: a tree holds a child
//   parent               an @yaks/edge relation: a commit follows a commit
//   compat               an @yaks/key kind: the same object's SHA-256 name
//   ref{app, name, commit}  where one branch of one repository stands
//
// The document itself is `./vocab.json` — plain JSON Schema, readable by
// anything that reads JSON. This file re-exports it under the name callers say
// and keeps the prose about why it is shaped the way it is.
//
// THE ID IS THE OBJECT'S ID. `gitobj` declares no `sha` column, because the
// entity's own eid is that value: an object written twice is one row without
// anybody declaring a constraint, and a `want` arriving over the wire is a
// `get` and not a query. It is the same trick @yaks/edge and @yaks/key play
// with a derived id — here the derivation is git's.
//
// `entry` AND `parent` ARE EDGES, not columns, because they are the two walks
// a pack has to make: parents for history, entries for reachability. Everything
// else about a tree or a commit is in the body bytes, where the digest that
// names the object was taken — a column for the author or the message would be
// a second copy nothing keeps honest.
//
// A `ref` IS A ROW, one per repository and branch name ({@link refEid}), and
// the only word here that is not about an OBJECT. Objects are one global graph
// — an object is named by the digest of its own bytes, so the same file in two
// repositories is one row — while a branch belongs to exactly one repository,
// which is why {@link refDoc} is the same vocabulary said on its own: a host
// that keeps its refs where it decides access and its objects in a store of
// their own loads one document in each.
//
// `compat` IS A KEY, not a column on `gitobj`, so the reverse lookup — a
// SHA-256 `want` arriving at a SHA-1 graph — is a `get` on a derived id rather
// than an index somebody has to remember to declare. Same mechanism as
// @yaks/alias's names. It is spelled with git's own word for the name in the
// other hash function rather than `oid256` because a component word in the
// query grammar is LETTERS (@yaks/query `SEG`): a comp nobody can say in a
// query is a comp nobody can read back.

import { CORE_URI, type VocabDoc } from '@yaks/vocab'
import doc from './vocab.json' with { type: 'json' }

/** The component naming a git object: what it is, and how long its body is. */
export let GITOBJ = 'gitobj'

/** The component naming where an object's bytes are. */
export let BLOB = 'blob'

/** The relation tag a tree's link to a child wears. */
export let ENTRY = 'entry'

/** The relation tag a commit's link to the commit it follows wears. */
export let PARENT = 'parent'

/** The key kind an object's SHA-256 name is stated under — git's own word for
 * the name in the other hash function is the compat oid. */
export let COMPAT = 'compat'

/** The component saying where one branch of one repository stands. */
export let REF = 'ref'

/**
 * This package's components as a vocabulary document, to load beside
 * @yaks/edge's and @yaks/key's:
 * `loadVocab([edgeDoc, keyDoc, gitDoc], [edgeKeywords, keyKeywords])`.
 */
export let gitDoc: VocabDoc = doc

/**
 * The `ref` word ALONE, for the graph that keeps a repository's branches when
 * that is not the graph its objects are in — the same declaration, so one
 * spelling means one thing in both.
 */
export let refDoc: VocabDoc = {
  $vocabulary: { [CORE_URI]: true },
  title: doc.title,
  $defs: { ref: doc.$defs.ref },
}
