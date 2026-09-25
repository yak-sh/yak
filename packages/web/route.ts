// The routing table: how a dotted word finds its column in THIS vocabulary.
// A bare prop routes to the one component that owns it (or a shared reference
// to every owner), a component name alone is a facet, a plural is a reverse
// association derived from the reference columns, and a store's own words
// route qualified beside the platform's. Everything here is a lookup over the
// vocabulary; nothing reads a row. query.ts binds clauses through it, and
// complete.ts offers what it knows.
import { bareType, isRef, type Prop, propAt } from './props.ts'
import {
  comps,
  derivedProps,
  type PropType,
  sessionComps,
  shapeOf,
  spineProps,
  stamped,
} from './types.ts'
import type { Tag } from '@yaks/sql'
import type { Hop } from './query.ts'

// Query-result-only components speak the same component grammar as stored
// graph data. They are readable results, never members of the writable `comps`
// vocabulary; the query engine supplies their declared inputs and values.
export let resultComps = {
  materialized: { text: true, scoped: true },
} as const
export type ResultComp = keyof typeof resultComps

// The readable routing table is the union of the wire, server, and transient
// result vocabularies. Keeping it derived means every readable column is
// immediately filterable through `.component.prop` without becoming writable.
export let routes: Record<string, readonly string[]> = Object.fromEntries(
  [
    ...new Set([
      ...Object.keys(comps),
      ...Object.keys(stamped),
      ...Object.keys(resultComps),
      ...Object.keys(derivedProps),
      ...Object.keys(spineProps),
    ]),
  ].map((name) => [
    name,
    Object.keys({
      ...comps[name],
      ...stamped[name],
      ...resultComps[name as ResultComp],
      ...derivedProps[name],
      ...spineProps[name],
    }),
  ]),
)

// An APP's own components (store/vocab.ts), declared by its vocab.json and
// planted in its own store. They route QUALIFIED only — `.recipe.serves`,
// `.recipe!` — never bare: a store's new word must not make `.title`
// ambiguous for every reader of every graph.
//
// GIVEN to the parse, never registered. One Worker isolate holds many stores,
// so a module-level registry made one app's word parse in another app's query
// — an `[]` where the unknown-prop refusal is owed, and which store got it
// depended on which store parsed first (T-32814). So every entry point takes
// the words it may use; db.ts keys them on the `Sql` handle (vocabOf), the
// same WeakMap the write path reads. The default is the platform vocabulary
// alone, which is every local graph.
//
// Parse-time only either way: no statement is ever compiled against a table a
// store lacks (sql.ts `known` reads `comps`, so these decline to the JS
// matcher, which reads the row's own components). Kept WITH their types,
// because a refusal says the shape (typeAt below).
// Components beside the platform's that a parse is given: name → columns.
export type Vocab = Record<string, Record<string, PropType>>
export let NONE: Vocab = {}

// What one readable column IS, either vocabulary — the type an unknown-column
// refusal spells beside its name.
export let typeAt = (
  comp: string,
  prop: string,
  vocab: Vocab,
): PropType | undefined =>
  comps[comp]?.[prop] ?? derivedProps[comp]?.[prop] ?? stamped[comp]?.[prop] ??
    vocab[comp]?.[prop]

// The routing table as this reader sees it: the vocabulary, plus whatever
// words the store being asked has declared. The platform's word wins, always.
export let routed = (
  name: string,
  vocab: Vocab,
): readonly string[] | undefined =>
  routes[name] ?? (vocab[name] && Object.keys(vocab[name]))

// A name a column or component already routes — the real props pred() resolves
// before any scope. A scope may not shadow one, so this is how the pred seam
// gives `.status`/`.project` priority over a same-named virtual prop.
export let owned = (name: string) =>
  name in routes || Object.values(routes).some((cols) => cols.includes(name))

// Every `{eid}` reference column in the vocabulary — wire-writable `comps`
// UNION the server-stamped columns (a session's `requested_task` is a reference
// even though the wire can't write it). `[comp, prop]` pairs; both the in-memory
// reverse index (index.ts realizes it) and the reverse-hop grammar below key off
// this ONE list, so a new ref column gets its reverse view for free (CLAUDE.md,
// "the vocabulary is one list"). index.ts re-exports it as the index derivation.
export let refCols: [string, string][] = [
  ...new Set([...Object.keys(comps), ...Object.keys(stamped)]),
].flatMap((c) =>
  Object.keys({ ...comps[c], ...stamped[c] })
    .filter((p) => isRef(c, p))
    .map((p) => [c, p] as [string, string])
)

// The synthetic prop the multi-column reverse-union resolves its value through:
// a plain entity reference with no owning column, so `.refs=T-3` turns T-3 into
// its eid at delivery exactly as a real `{eid}` column would (resolveRefs).
export let REFS_PROP: Prop = {
  comp: '',
  prop: 'refs',
  name: 'refs',
  type: { eid: 'entity', death: 'keep' },
}

// A reverse ASSOCIATION: a component's `{eid}` ref column seen from the far side.
// `.comments` are the entities whose comment.target points at me. One per ref
// column, DERIVED from refCols — never hand-listed — named plural(comp) when the
// comp has a single ref column, plural(comp)_{prop} when several ref columns
// share the plural (the prop says which pointer). English is not the goal;
// uniqueness is (shelf→shelfs is fine). A name colliding with a real prop is
// left out, so a real column always wins its spelling — the scopes discipline.
export type Assoc = { comp: string; prop: string }
let plural = (s: string) =>
  s.endsWith('y') ? s.slice(0, -1) + 'ies' : s.endsWith('s') ? s : s + 's'
export let reverseAssocs: Map<string, Assoc> = (() => {
  let byComp = new Map<string, string[]>()
  for (let [c, p] of refCols) byComp.set(c, [...(byComp.get(c) ?? []), p])
  let m = new Map<string, Assoc>()
  for (let [c, p] of refCols) {
    let name = byComp.get(c)!.length == 1 ? plural(c) : `${plural(c)}_${p}`
    if (!owned(name)) m.set(name, { comp: c, prop: p })
  }
  return m
})()

// The reserved query WORDS — directives that are neither a column nor an
// association: `.refs` (the multi-column reverse-union), the `.distinct` /
// `.tally` aggregates, `.fields` (the projection), `.limit`/`.after` (the
// window), `.edges` (the incident-edge rider). Guarded here the way scopes and reverse assocs are, so a
// vocabulary that ever grows one of these as a real prop is a load error rather
// than a silently dead directive.
export let reserved = [
  'refs',
  'distinct',
  'tally',
  'fields',
  'limit',
  'after',
  'edges',
]
for (let name of reserved) {
  if (owned(name)) {
    throw new Error(`reserved query word .${name} shadows a prop`)
  }
}

// The dot-param shape, sketched — the tail of every strict rejection
// (FILTERS in grammar.ts spells the operators). Every example is a word the
// vocabulary carries in EVERY graph: an error is read by whoever asked, and a
// hosted app's store must never be taught with another graph's entity ids.
let SKETCH =
  'filters are dot-params: .status=open, .priority<=1, .title~=word, ' +
  '.doc.title~=word, …'

// What THIS process teaches a reader who named a word it does not know. The
// sketch above by default; a store with a vocabulary of its own replaces it
// (db.ts plantVocab → store/vocab.ts FILTERS) so the tail says vocab.json
// instead of a CLI the reader has never seen. Per process, because a process
// serves one flavour of store: the fleet's local graph, or hosted apps.
export let taught = SKETCH

export let teaches = (line: string) => {
  taught = line
}

// The names agents reach for that are EDGES — a relation has no column and
// never will, so the sketch answers the wrong question in either grammar. The
// door says what it DOES ('link one'), because from a filter this is the shape
// of the mistake, not a listing verb.
export let edgeish = /block|depend|require|parent|child|subtask/i
export let EDGE_DOOR =
  'a relation is an EDGE, not a prop: an edge is its own ' +
  'entity, edge{from, to} wearing its nature' +
  " — or 'task <parent> requires <child>'"

// An edge word used as a path HOP: walking edges is one-to-many (any/all
// semantics), a different traversal than this {eid}-column deref, and its own
// ticket. The refusal names it so the two are never conflated.
export let EDGE_HOP = (word: string) =>
  `.${word} walks edges, not an {eid} column — edge-hop traversal ` +
  'is not served; a column path derefs reference props ' +
  '(.comment.target.doc.title)'

// Component columns that never claim their BARE prop spelling — an established
// bare filter of a different concept already owns it, so the newcomer is
// reached only through its component (`.fork.from`, `.accept.body`). The fork
// point yields bare `.from` to mail's sender; acceptance criteria yield bare
// `.body` to the shipped doc-body filter; an edge's endpoints (D-23820) yield
// `.from` and `.to` the same way — `.edge.from=X` is the reverse-index read.
// A membership's `person` yields bare `.person` to the person COMPONENT: a
// presence test already routes there (`.person!` IS a person), so the column
// owning the absent half made one bare word name two things — and an app's
// page, which asks for people with `.person!` and for everything else with
// `.person=`, could spell only half of that (T-32627). `.member.person=`
// still reads the membership. A catalog model's `provider` and `effort`
// (T-35023) yield both bare words to the SPAWN spelling every board and CLI
// filter already means by them — `.provider=codex` asks which agent ran, not
// which entity serves a model; `.model.provider=` reads the catalog.
// A tracked process (T-35323) yields all three of its bare words the same way:
// `.pid` and `.cwd` already mean the SESSION's — the reading every board and
// CLI filter has — and `.command` means the bash entry's. `.process.pid=`
// reaches the newcomer, and `.process!` still asks which entities are one.
// The service that wants one (T-35328) yields its two namesakes for the same
// reason; `.restart` and `.attempts` are its own words, so they stay bare.
let bareShy = new Set([
  'process.pid',
  'process.cwd',
  'process.command',
  'service.cwd',
  'service.command',
  'fork.from',
  'accept.body',
  'edge.from',
  'edge.to',
  'member.person',
  'model.provider',
  'model.effort',
])

// These associations already had one bare filter across several suffixed
// columns. Keep that reading after the columns take their canonical names;
// other collisions (`by`, `at`) remain explicit as before.
let sharedRefs = new Set(['actor', 'canvas', 'client', 'scope', 'target'])
export let sharedRef = (prop: string, owners: string[]) =>
  owners.length > 1 && sharedRefs.has(prop) && isRef('', prop)

// Route a bare prop to its component; ambiguity is an error that names the
// candidates rather than a guess. Same-named references are one read concept:
// comp '' makes a filter scan every owner, while writes demand a component.
export let route = (
  prop: string,
  vocab: Vocab = NONE,
): { comp: string; prop: string } => {
  let hits = (p: string) =>
    Object.entries(routes)
      .filter(([, cols]) => cols.includes(p))
      .map(([name]) => name)
      // Session-log columns are an explicitly addressed lazy partition.
      // Bare graph props keep their shipped meanings; log predicates say
      // `.response.status`, `.content.body`, `.generation.provider`, etc.
      .filter((name) => !(name in sessionComps))
      // A newcomer that shares a name with an ESTABLISHED bare filter of a
      // different concept never steals the bare spelling — it is reached
      // qualified by its component. `fork.from` (the fork-point entry ref, a
      // session facet) shares `from` with the shipped `.from` = `mail.from`
      // sender filter (query.ts:659, `task inbox .from=…`); the writable-vs-
      // stamped rule below would silently repoint bare `.from` onto the fork
      // ref, so bare `.from` keeps meaning mail's sender and `.fork.from`
      // reaches the fork — the same "bare keeps its shipped meaning, qualified
      // reaches the newcomer" split parent/child already use.
      .filter((name) => !bareShy.has(`${name}.${p}`))
  let own = hits(prop)
  // A stamped lifecycle field may share a name with an established writable
  // filter (`session.status` and `task.status`). Qualified reads reach both;
  // bare routing keeps the writable — or derived (D-24102) — spelling instead of
  // manufacturing a new ambiguity. `task.status` is a DERIVED column now, no
  // longer writable, so it must still win bare `.status` over stamped
  // `session.status`. When every owner is stamped, the normal ambiguity/twin
  // rules below still apply.
  let preferred = own.filter((name) =>
    prop in (comps[name] ?? {}) || prop in (derivedProps[name] ?? {})
  )
  if (preferred.length) own = preferred
  // Parent/child words are the edge vocabulary. Their component refs
  // remain available through `.pane.parent` / `.session.parent`; bare keeps
  // teaching the edge door instead of silently changing an old mistake.
  // A real component is never edge vocabulary, though — `blocked` merely
  // CONTAINS `block`, so the broad net would swallow a genuine facet. Guard
  // it: a registered component keeps its owners and reaches the presence
  // grammar below, so `.blocked!` filters what is stuck rather than teaching
  // the edge door. Only NON-components fall to the door.
  if (edgeish.test(prop) && !(prop in comps)) own = []
  if (own.length == 1) return { comp: own[0], prop }
  if (sharedRef(prop, own)) return { comp: '', prop }
  if (own.length > 1) {
    throw new Error(
      `.${prop} is ambiguous (${own.join(', ')}) — use .${own[0]}.${prop}`,
    )
  }
  // A facet is itself filterable. Scalar and reference columns win above,
  // preserving `.project=P-3`; a component with no namesake column gets the
  // presence grammar (`=` absent, `~=` present) without a second vocabulary.
  if (routed(prop, vocab)) return { comp: prop, prop: '' }
  // (.kind is a SCOPE handled before route(), .id routes through session.id,
  // and .eid routes to the spine through spineProps, so none reaches here.)
  throw new Error(
    `unknown prop: .${prop} — ${edgeish.test(prop) ? EDGE_DOOR : taught}`,
  )
}

// A shared reference has no one owning component, but its type is still
// known: the vocabulary is searched by name. All other aims come straight
// from the vocabulary, including a path's far side.
export let typed = (comp: string, prop: string): Prop | undefined => {
  let p = propAt(comp, prop)
  if (p) return p
  let type = !comp ? bareType(prop) : undefined
  return type ? { comp, prop, name: prop, type } : undefined
}

export let kind = (p: Prop) =>
  typeof p.type == 'string'
    ? p.type
    : 'enum' in p.type
    ? 'enum'
    : 'eid' in p.type
    ? 'eid'
    : 'text'

// What a column is to a VALUE comparison: the word @yaks/match and the SQL
// dialect both switch on, so the in-memory answer and the lowered one agree on
// which columns compare as numbers and which read a time phrase. Both
// vocabularies were emitted from the same manifests, so the spellings already
// line up — a body is the one fleet word @yaks/sql has no Scalar for, and it is
// text. A column the vocabulary cannot type is text too, which compares the way
// the wire carries every value.
export let tagOf = (p?: Prop): Tag => {
  let k = p ? kind(p) : 'text'
  return (k == 'body' ? 'text' : k) as Tag
}

// Dotted segments to the hops they name, applying ONE rule at each step: a
// segment that names a COMPONENT with another segment behind it is the explicit
// `comp.prop` spelling and eats two (.comment.target); anything else is a bare
// prop routed by name and eats one (.assignee). The final group is the leaf
// tested against op/value; every earlier group is a deref the caller checks is
// an `{eid}` column. So `.comment.target.doc.title` is [(comment,target)] then
// (doc,title), and `.assignee.title` is [(task,assignee)] then (doc,title) —
// one traversal, two spellings.
export let groupsOf = (segs: string[], vocab: Vocab): Hop[] => {
  let out: Hop[] = []
  for (let i = 0; i < segs.length;) {
    // A component consumes its next segment as the explicit `comp.prop`
    // spelling; a component with nothing behind it is a bare facet (route()).
    let own = routed(segs[i], vocab)
    if (own && i + 1 < segs.length) {
      let [a, b] = [segs[i], segs[i + 1]]
      // The refusal names what IS there: one look, the whole shape (db.ts
      // admitted() says the same thing at the write door).
      if (!own.includes(b)) {
        throw new Error(
          `no such prop: .${a}.${b} — ${
            shapeOf(a, own, (col) => typeAt(a, col, vocab))
          }`,
        )
      }
      out.push({ comp: a, prop: b })
      i += 2
    } else {
      // A bare word that isn't the final segment is a deref hop; an edge word
      // there is an edge-HOP (T-14078), never an {eid}-column deref.
      if (i + 1 < segs.length && edgeish.test(segs[i])) {
        throw new Error(EDGE_HOP(segs[i]))
      }
      out.push(route(segs[i], vocab))
      i += 1
    }
  }
  return out
}
