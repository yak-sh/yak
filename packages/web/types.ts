// The browser's vocabulary: what each component is, learned from the graph it
// is looking at. A host serves the documents it composed (`/web/vocab.json`,
// @yaks/web routes.ts) and `learn()` reads the tables below out of them before
// anything renders, so the page and the server read one set of components.
// Nothing here is written down per component: a plugin the host lists is
// understood the moment the host loads it.
//
// In a browser the documents are fetched at the top of this module, so every
// module that imports it evaluates after the tables are full. Under Deno the
// tables start empty until something calls learn(): the tests learn the
// documents a host composes (testing.ts), a terminal the ones its server
// serves.

import {
  type Keywords,
  loadVocab,
  type Vocab,
  type VocabDoc,
} from '@yaks/vocab'
import { idOf as idsOf, prefixes, SHORT } from '@yaks/id'
import { idKeywords } from '@yaks/id/vocab'
import { nameKeywords } from '@yaks/names'
import { edgeKeywords } from '@yaks/edge/vocab'
import { blobKeywords } from '@yaks/blob'
import { kernelKeywords } from '@yaks/kernel/vocab'
import { keyKeywords } from '@yaks/key/vocab'
import { statusOf as taskStatus } from '@yaks/task'
import { taskMarks } from '@yaks/session/vocab'

export let statuses = ['open', 'wip', 'done', 'cancelled'] as const
export let turnStates = ['idle', 'busy'] as const
export let messageRoles = ['user', 'agent'] as const
export let httpMethods = [
  'GET',
  'HEAD',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
] as const
export let roleStates = [
  'running',
  'stopped',
  'paused',
  'disabled',
  'retired',
  'held',
] as const
export let roleSurfaces = ['native', 'managed'] as const
export let wakePolicies = [
  'always',
  'attention',
  'scheduled',
  'manual',
] as const
export let ventureStates = [
  'incubating',
  'idea',
  'building',
  'launching',
  'live',
  'hold',
  'paused',
  'shuttered',
  'killed',
] as const
export let ventureModes = ['long-loop', 'cold', 'cron'] as const
export let dirs = ['h', 'v'] as const
export let subModes = ['watch', 'mute'] as const
export let verdicts = ['approved', 'rejected', 'changes_requested'] as const
export let grades = ['frontier', 'mid', 'small'] as const
export let transports = ['process', 'http'] as const
export let signalKinds = ['lapse', 'sweep', 'scene', 'wake'] as const
export let effectStates = ['pending', 'leased', 'delivered', 'failed'] as const
export let appAccess = ['public', 'open', 'private'] as const
export let planTiers = ['free', 'plus'] as const
export let hostnameStages = ['pending', 'active', 'error'] as const

// The keyword vocabularies the documents are written with: every set the
// packages ship.
export let keywords: Keywords[] = [
  idKeywords,
  nameKeywords,
  edgeKeywords,
  blobKeywords,
  kernelKeywords,
  keyKeywords,
]

// The loaded vocabulary itself, for readers that ask it directly (the renderer
// registry, the browser replica).
export let vocab: Vocab = loadVocab([], keywords)

// Components a session's transcript is written in: they never claim a bare
// spelling in a filter (`bare: false`).
export let sessionComps: Record<string, Record<string, PropType>> = {}

// The components and their wire-writable columns, each with what it IS.
export let comps: Record<string, Record<string, PropType>> = {}

// Composite indexes (see index.ts): what a component declares `index` or
// `unique` over.
export let indexes: Record<string, Idx[]> = {}

// Components never part of a working set (the kernel's `lazy` keyword): a
// view that needs them holds its own subscription (live.ts entrySub).
export let partition: Record<string, 'eager' | 'lazy'> = {}

// Server-stamped columns — never wire-writable, still read.
export let stamped: Record<string, Record<string, PropType>> = {}

// kind is DERIVED: the most specific component an entity carries names it.
export let kindOrder: string[] = []

// Kinds whose doc title is a NAME a caller can type (near.ts).
export let byName = new Set<string>()

// The letter each component's ids wear (@yaks/id `prefixes`): `T` for a task.
export let prefix: Record<string, string> = {}

// An entity's id as a person reads it: `T-9` once the store numbers it, its
// short handle `#3b5bc70420` until then. @yaks/id's, the one every door reads
// an id through.
export let idOf = idsOf(vocab)

let irregular: Record<string, string> = {
  person: 'people',
}

// The edge vocabulary — every edge reads as a sentence, parent first: each
// relation a component declares with the `edge` keyword.
export let edges: string[] = []

// Durable work/knowledge facets governed by project-rooted edge paths.
export let governed = ['task', 'architecture', 'memory', 'persona'] as const

// What the host derives a session's status as, and the ones still going.
export let sessionStates = [
  'pending',
  'running',
  'settled',
  'stopped',
  'failed',
] as const
export let sessionActive = ['pending', 'running']

// One property, in the words the views speak (PropType below).
let typeOf = (v: Vocab, comp: string, prop: string): PropType => {
  let p = v.prop(comp, prop)!
  let raw = (v.def(comp)?.properties?.[prop] ?? {}) as {
    store?: string
    well?: string
  }
  if (p.category == 'ref') {
    return { eid: p.ref || 'entity', death: p.death ?? 'keep' }
  }
  if (p.category == 'enum') {
    return {
      enum: p.values ?? [],
      ...(p.aliases ? { aliases: p.aliases } : {}),
    }
  }
  if (raw.store == 'blob') return 'body'
  if (raw.well) return { text: raw.well }
  let s = p.scalar
  return s == 'bool' || s == 'number' || s == 'priority' || s == 'time' ||
      s == 'url' || s == 'query'
    ? s
    : 'text'
}

/** Read the tables above out of a host's vocabulary documents, replacing
 * whatever was learned before. */
export let learn = (docs: VocabDoc[]): Vocab => {
  let v = loadVocab(docs, keywords)
  let c: typeof comps = {}
  let st: typeof stamped = {}
  let log: typeof sessionComps = {}
  let ix: typeof indexes = {}
  let names = new Set<string>()
  let relations: string[] = []
  let parts: typeof partition = {}
  // The spine's columns are the store's to stamp: read and filtered on, never
  // written. Its identity, eid, is read through spineProps below.
  let spine = v.props('entity').map((p) => [p, typeOf(v, 'entity', p)])
  if (spine.length) st.entity = Object.fromEntries(spine)
  for (let name of v.all.filter((n) => n != 'entity')) {
    let def = (v.def(name) ?? {}) as {
      bare?: boolean
      edge?: string
      by_name?: boolean
      index?: string[][]
      unique?: string[][]
    }
    let own: Record<string, PropType> = {}
    let server: Record<string, PropType> = {}
    // A computed column is the host's to derive: read, filtered on, never
    // written — the same standing as a stamped one.
    for (let prop of v.props(name)) {
      let p = v.prop(name, prop)!
      ;(p.stamped || p.computed ? server : own)[prop] = typeOf(v, name, prop)
    }
    c[name] = own
    if (Object.keys(server).length) st[name] = server
    if (def.bare === false) log[name] = own
    let rows = [
      ...(def.unique ?? []).map((cols) => ({ cols, unique: true })),
      ...(def.index ?? []).map((cols) => ({ cols })),
    ].filter((r) => Array.isArray(r.cols))
    if (rows.length) ix[name] = rows
    if (def.by_name) names.add(name)
    if (typeof def.edge == 'string') relations.push(def.edge)
    if (v.comp(name)?.keywords?.lazy) parts[name] = 'lazy'
  }
  vocab = v
  comps = c
  stamped = st
  sessionComps = log
  indexes = ix
  prefix = prefixes(v)
  idOf = idsOf(v)
  byName = names
  edges = relations
  partition = parts
  kindOrder = [...v.kinds]
  kindRank = new Map(kindOrder.map((k, i) => [k, i]))
  planted = 0
  plurals = new Set(kindOrder.flatMap((k) => [plural(k), `${k}s`]))
  return v
}

// What a prop IS — the detection layer editors and docs read. The
// vocabulary stays deliberately tiny:
//   'text'            one line (sometimes more)
//   'body'            long markdown
//   'number' 'bool'   what they say
//   'priority'        a number operators spell with an optional P
//   'query'           a line of the filter grammar (query.ts) — text
//                     whose editor knows the vocabulary
//   'time'            an ISO timestamp — a text column whose face is
//                     relative words (full stamp on hover)
//   'url'             an address out on the web — a text column whose
//                     face is a link
//   {enum: [...]}     a closed set; aliases are input spellings only
//   {eid: 'project',  an association; the name says which component the
//    death: …}        target carries ('entity' = any entity — the spine is
//                     a real component, so 'entity' names it like any
//                     other, never a falsy '' that truthiness misreads),
//                     the death word what the reference means when the
//                     target dies
//   {text: 'domains'} open text, suggestions from a named WELL the
//                     browser registers (the schema stays declarative —
//                     it can't reach a live cache from here)

// Every reference declares what the reaper does when its TARGET dies —
// the host derives the cascade from these words, so a reference without one
// doesn't typecheck and an undeclared behavior can't exist:
//   'cascade'  the row's whole entity dies with the target (a card
//              viewing it, a comment aimed at it)
//   'detach'   the column lets go — set null, and the wire hears it
//              (a task's dead project or assignee)
//   'release'  the ROW dies but its entity lives — for tag comps whose
//              existence is the reference (a claim: the lease vanishes,
//              the claimed task survives)
//   'keep'     the reference stands as history — the target's tombstone
//              is the only mark (dead provenance)
export type Death = 'cascade' | 'detach' | 'release' | 'keep'

export type PropType =
  | 'text'
  | 'body'
  | 'number'
  | 'priority'
  | 'bool'
  | 'query'
  | 'time'
  | 'url'
  | { enum: readonly string[]; aliases?: Record<string, string> }
  | { eid: string; death: Death }
  | { text: string }

// One column's type in a word an app author already knows — the five a
// vocab.json may spell (store/vocab.ts TYPES), plus `eid` for a reference and
// the values themselves for a closed set. The internal spellings collapse:
// a body and a saved query are text, a priority is a number.
export let typeName = (t: PropType): string =>
  typeof t == 'string'
    ? t == 'body' || t == 'query' ? 'text' : t == 'priority' ? 'number' : t
    : 'enum' in t
    ? t.enum.join('|')
    : 'eid' in t
    ? 'eid'
    : 'text'

// A component's whole shape, said in one line: `attachment has artifact
// (eid), media_type (text), name (text)`. Every unknown-column refusal carries it, at the
// write door and the filter door alike, because a refusal that names only what
// it did not understand teaches nothing — the seventh user test learned
// `artifact` by guessing five times and still read `size` as the bytes
// (C-32675 items 2 and 3). `type` is how the caller's vocabulary answers what
// a column is; a column it cannot type says its name alone.
export let shapeOf = (
  name: string,
  cols: readonly string[],
  type: (col: string) => PropType | undefined = () => undefined,
): string => {
  let said = cols.map((col) => {
    let t = type(col)
    return t ? `${col} (${typeName(t)})` : col
  })
  return said.length
    ? `${name} has ${said.join(', ')}`
    : `${name} has no columns`
}

export let verdictName = (verdict?: string | null) =>
  String(verdict ?? '').replaceAll('_', ' ')

// DERIVED columns (D-24102): readable exactly like a stored column — filter,
// project, tally, sort — but absent from `comps`/`stamped`, so raw graph writes
// cannot store one. The query evaluators compute the value (statusOf in query.ts
// read() and its SQL CASE mirror). Merged into readable routing so `.status` and
// `.task.status` resolve and type-check; CLI/MCP compatibility writers expand
// that spelling into facets. `status` is the first and only member: it reads
// completed/cancelled/claim.
export let derivedProps: Record<string, Record<string, PropType>> = {
  task: { status: { enum: statuses } },
}

// The spine's own identity column. The contract declares what a store STAMPS on
// `entity` (num); the `eid` beside it is the identity itself — readable on every
// row, never writable, and derived
// from nothing, so it belongs to neither map above. Declared here so both
// routing tables carry it and `.eid=<id>` NAMES entities at this door exactly as
// @yaks/sql and @yaks/match answer the same predicate.
export let spineProps: Record<string, Record<string, PropType>> = {
  entity: { eid: 'text' },
}

// Task status is derived, never stored (D-24102). The rule is @yaks/task's
// `statusOf` over @yaks/session's ladder: `cancelled`, then `completed`, then a
// held `claim` reads wip, then the `task.status` the row carries, else open. The
// carried value is what the host derived; it holds where a row arrives without
// its marks (a read answers the components it names, and an edge rider ships
// projected columns only). A mark the row does carry wins, so a local patch
// reads its own evidence before the host's older answer. `has` is a component
// bag (a live row's `.comps`, a Row's comps).
export let statusOf = (has: Record<string, unknown>) =>
  taskStatus(has, taskMarks) ?? 'open'

// Settled = no longer open work, whether it finished or was called off.
// Gating, board defaults, and lease-lapse audits all key off this
// instead of 'done' alone, so a cancelled blocker releases its gate too.
export let settled = (status?: string | null) =>
  status == 'done' || status == 'cancelled'

// The shape of one index declaration (see the indexes map in the data
// section above): its columns, uniqueness, and an optional partial-index
// predicate.
export type Idx = { cols: string[]; unique?: boolean; where?: string }

export let lazy = (name: string) => partition[name] === 'lazy'

// A component's wire-writable column names — what most consumers of the
// old flat list actually want.
export let cols = (comp: string) => Object.keys(comps[comp] ?? {})

// The reaper's worklists, derived: every wire-writable reference wearing
// the given death word, as (comp, column) pairs. The host walks these when
// an entity dies — the declarations above ARE the cascade, so a new
// reference can't dodge the reaper by forgetting a hand-kept list.
// (`stamped` refs stay out on purpose: server-owned rows die by server
// code, not by the wire's cascade.)
export let deaths = (word: Death): [string, string][] =>
  Object.entries(comps).flatMap(([name, props]) =>
    Object.entries(props).flatMap(([col, t]) =>
      typeof t == 'object' && 'eid' in t && t.death == word
        ? [[name, col] as [string, string]]
        : []
    )
  )

// The eid minter. Both sides of the wire mint them (clients name their own
// entities), so it must work on both: crypto.randomUUID is gated to secure
// contexts and this page is served over plain http on the tailnet, while
// getRandomValues is gated nowhere.
export let uuid = () => {
  let b = crypto.getRandomValues(new Uint8Array(16))
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  let h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${
    h.slice(16, 20)
  }-${h.slice(20)}`
}

// One log line, in the vocabulary the RENDERER speaks — flat and small, the
// same six shapes whatever provider wrote it. @yaks/session's readers own the
// dialects and turn each line into transcript entries, and entry_log.ts turns
// those into these, so the Session view never learns a vendor:
//   say    what the agent (or the human, resuming) actually said
//   reason the model thinking out loud — dim, skippable
//   tool   a tool call as a chip: name + ok/✗, its detail, its error
//   exec   a shell command it ran — desc says what for, in its own words
//   turn   a turn closing, with usage and duration — a divider, not content
//   error  the run itself went wrong
//   sys    provider housekeeping worth a dim chip: the tag names the
//          family (thinking, hook, task, …), the text carries the gist.
//          A view may squeeze a run of same-tag frames into one line.
// `at` is the event's clock when the dialect (or our own writer) carries one.
export type LogRow =
  & { at?: string; context?: number }
  & (
    | { kind: 'say'; role: 'agent' | 'user'; text: string }
    | { kind: 'reason'; text: string }
    | {
      kind: 'tool'
      name: string
      detail?: string
      ok?: boolean
      error?: string
    }
    | {
      kind: 'exec'
      command: string
      desc?: string
      exit?: number
      status?: string
    }
    | { kind: 'turn'; model?: string; usage?: string; ms?: number }
    | { kind: 'error'; text: string }
    | { kind: 'sys'; tag: string; text?: string }
  )

// Token counts the way a human reads them: 831, 12k, 1.2M.
export let kilo = (n: number): string =>
  n < 1000
    ? String(n)
    : n < 1e6
    ? `${+(n / 1e3).toFixed(n < 10_000 ? 1 : 0)}k`
    : `${+(n / 1e6).toFixed(1)}M`

// Precedence as a LOOKUP, one rank per kind. kindOf runs once per row on
// every snapshot read, so it must cost the ENTITY's component count (a
// handful), never the vocabulary's (~50 and growing): a scan down kindOrder
// charges every row for wherever its kind happens to sit, and kindOrder is
// derived (alphabetical, refined by `before`), so nothing keeps the hot
// kinds near the front of it.
//
// An APP's own components join the same table when a store
// plants them — the registry query.ts keeps for the
// filter grammar, safe for the same reason: a row wears a word only if its
// OWN store planted the table, so no store is ever told about another's
// rows. They rank NEGATIVE in the order learned, so a store's word beats
// every platform kind and an earlier-planted word beats a later one.
let kindRank = new Map(kindOrder.map((k, i) => [k, i]))
let planted = 0

export let learnKinds = (names: Iterable<string>) => {
  for (let name of names) if (!kindRank.has(name)) kindRank.set(name, --planted)
}

// A store's own word is the most specific thing it says about a row, so it
// outranks every platform kind: an entity carrying `book` IS a book, not the
// `doc` it also wears for its title (C-32574 item 7).
export let kindOf = (has: Record<string, unknown>) => {
  let kind = 'entity'
  let best = Infinity
  for (let k in has) {
    if (!has[k]) continue
    let r = kindRank.get(k) ?? Infinity
    if (r < best) [best, kind] = [r, k]
  }
  return kind
}

// Kinds are singular in the graph and plural in the mouth — a listing is
// asked for `projects`, never `project`. Derived, so a new kind gets its
// listing word the moment it joins kindOrder.
export let plural = (kind: string) =>
  irregular[kind] ??
    (kind.endsWith('y')
      ? `${kind.slice(0, -1)}ies`
      : /(?:s|x|ch|sh)$/.test(kind)
      ? `${kind}es`
      : `${kind}s`)
// Every plural spelling — the naive one rides along so whatever a listing
// accepts as a word, the bare verb accepts too.
export let plurals = new Set(kindOrder.flatMap((k) => [plural(k), `${k}s`]))

// The word a caller types for a kind, in either number — the naive plural
// too, so `persons` still lands where `people` does.
export let kindWord = (word: string) =>
  kindOrder.find((k) => k == word || plural(k) == word || `${k}s` == word)

// Identity refusals must not become a saved query's ordinary "not loaded" miss.
export class IdError extends Error {}
// The hex a short handle (@yaks/id `SHORT`, `#3b5bc70420`) names.
export let shortHex = (id: string) =>
  SHORT.test(id) ? id.slice(1).toLowerCase() : undefined
// A WHOLE eid, in every shape a client may name an entity by: the uuid it
// mints, or the hash a content-addressed entity is its own name by — a
// blob's sha-256 (64 hex), a commit's git sha (40). One spelling for every
// id door, so none of them can drift out of knowing a shape the others take
// (props.ts reference, client.ts minting).
export let EID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$|^[0-9a-f]{40}$|^[0-9a-f]{64}$/i

// A model's short name — 'claude-fable-5' is fable, 'gpt-5.6-sol' is sol:
// drop the vendor word and anything wearing a digit, keep what's left.
// The composer greets an agent by it; a persona's name outranks it once
// personas exist.
export let nick = (model?: string | null) => {
  let words = (model ?? '').split('-')
    .filter((w) => w && !/\d/.test(w) && w != 'claude' && w != 'gpt')
  return words.join('-') || null
}

// A model id worn friendly — nick's display face: the vendor prefix and
// date pin drop, version digits regain their dots, words their caps.
// 'claude-opus-4-8' → 'Opus 4.8', 'gpt-5.6-sol' → 'GPT 5.6 Sol'.
export let friendly = (model?: string | null) => {
  let words: string[] = []
  for (
    let w of (model ?? '').replace(/-\d{8}$/, '').split('-').filter(Boolean)
  ) {
    if (/^[\d.]+$/.test(w) && /\d$/.test(words.at(-1) ?? '')) {
      words[words.length - 1] += `.${w}`
    } else if (w != 'claude') {
      words.push(w == 'gpt' ? 'GPT' : w[0].toUpperCase() + w.slice(1))
    }
  }
  return words.join(' ') || null
}

export type Edge = (typeof edges)[number]

// The written face of an entity — title and markdown body. Anything can
// carry one: tasks and boards do; notes, comments, and future kinds get
// rendering/editing/files for free by carrying it too.
// `body` is optional because a payload may DEFER it (a `.fields=` projection):
// undefined means unloaded, '' means empty, and the column defaults to ''
// so the two can never be confused. Every reader must tell them apart —
// paint a placeholder and ask (live.ts `pending`), never treat a missing
// body as an empty one, which is how an editor clobbers a stored body.
export type Doc = { eid: string; title: string; body?: string }

// Workflow state only — a task is a doc with task-management added.
export type Task = {
  eid: string
  // DERIVED (D-24102), never stored: statusOf reads it off the completed/
  // cancelled/claim comps, and rowed() materializes it onto a read shape. Present
  // on a row that has been through statusOf; absent on a bare write literal.
  status?: string
}

// Optional portfolio filing; a microtask carries none of these columns.
export type Filed = {
  eid: string
  priority?: number | null // board order within a status column; lower sorts first
  project?: string | null // the project (venture) this task belongs to
  assignee?: string | null // whose plate — durable; claim is who's on it now
  // Cross-project facet (Eng, Legal, Ops, …), free text by convention; a
  // picker derives its options from distinct values.
  domain?: string | null
}

// Acceptance criteria are their own deferred Markdown body, distinct from the
// task's narrative and from the review that records a verdict.
export type Accept = { eid: string; body?: string }

// A tag: "this doc fronts a project" (a venture, a workstream). Its name
// is its doc.title — one naming mechanism, no drift. An archived project is
// over — kept, referenceable, sunk in every ranking.
export type ProjectTag = { eid: string }

// Where a project's code lives: a checkout on this box and the branch a
// session's worktree grows from. A tag like project — it never names an
// entity alone (doc+project+repo is still a project), so it stays out of
// kindOrder. Wire-writable, because the owner points a project at a
// checkout from the UI or the CLI like any other data; spawning only
// READS it, so a browser can never hand the server a path to run in.
// `push` is that same owner saying the projection's commits may leave the
// box for this venture — a per-venture permission because in some of them
// a push to main deploys.
export type Repo = {
  eid: string
  path: string
  url?: string | null
  base_branch: string
  gate?: string | null
  push?: boolean
}

// A project's venture facet: where it sits in its lifecycle and how it's run.
// A tag like project/repo — it never names an entity alone, so it stays out
// of kindOrder. paused_from/hold_from carry the phase a reversible stop will
// restore; run_mode/agent_model/operated_by are the interim operator binding.
export type Venture = {
  eid: string
  phase?: string | null
  paused_from?: string | null
  hold_from?: string | null
  run_mode?: string | null
  agent_model?: string | null
  operated_by?: string | null
  tagline?: string | null
  site?: string | null
}

// A board is a saved filter over tasks: `query` speaks the query.ts
// grammar ('.project=…&.status=open,wip'); empty/null selects NOTHING —
// a board that means "every task" says `.task`.
export type BoardTag = { eid: string; query?: string | null }

// A tiling layout (D-14718): the doc names it, root its top pane.
export type LayoutTag = { eid: string; root?: string | null }

// One pane: container (dir set, children point here via parent) or
// leaf (content + view). size is its weight among siblings.
export type Pane = {
  eid: string
  layout?: string | null
  parent?: string | null
  size?: number
  order?: number
  dir?: string | null
  content?: string | null
  view?: string | null
}
// An external page. The URL is what was pasted; the rendered thing is the
// server's frozen archive of it (one self-contained HTML file on disk),
// stamped frozen_at when ready — frozen_at is server-owned, never wire-set.
export type Web = { eid: string; url: string; frozen_at?: string | null }
// Immutable content: eid is its SHA-256; external bytes live beside the db.
// The word is @yaks/blob's own for the stored thing — `blob` there names the
// STORE, and @yaks/git's `blob{sha}` is a git blob, a different idea.
export type Artifact = {
  eid: string
  size?: number | null
}
// Per-use file metadata points at shared content.
export type Attachment = {
  eid: string
  artifact: string
  media_type?: string | null
  name?: string | null
}
export type Image = {
  eid: string
  w?: number | null
  h?: number | null
}
export type CardComp = { eid: string; target: string; view: string }
export type Pin = {
  eid: string
  canvas: string
  x: number
  y: number
  w: number
  h: number
  z: number // stacking order; dragging a card raises it to top
}

// A browser identity: its uuid is minted client-side into localStorage on
// first visit. ip is server-stamped (a client can't self-report one).
export type Client = {
  eid: string
  user_agent: string
  ip: string
  actor?: string | null // who this browser acts for (comps comment)
}

// A camera joins a client to a canvas: per-client pan/zoom, one row per
// (client, canvas) pair — canvases nest, so this is NOT keyed by the client.
// x/y is the viewport CENTER in plane coords; w/h is the viewport size in
// screen px, stored so other clients can render each other's viewports.
export type Camera = {
  eid: string
  client: string
  canvas: string
  x: number
  y: number
  zoom: number
  w: number
  h: number
}

// A client's folded columns on one board — per-client UI state IN the
// graph (like camera), so it syncs across tabs and agents can see it.
// statuses is a comma-joined list of folded column names.
export type Fold = {
  eid: string
  client: string
  board: string
  statuses: string
}

// The Shelf: a per-client scratch canvas the Tray hangs cards on. A tag
// like repo — it binds a client to their one shelf without naming the
// entity (the entity stays a canvas), so it stays out of kindOrder.
export type Shelf = { eid: string; client: string }

// A cursor joins a client to where it is LOOKING — one row per client, the
// per-client twin of camera (which is per client+canvas). target is the
// fullscreened entity, view its ?v= tab. Navigation as graph data: the
// browser writes it on navigate, an agent writes it to move the human's tab.
export type Cursor = {
  eid: string
  client: string
  target?: string | null
  view?: string | null
}

export type Favorite = { eid: string; at?: string | null }
export type Setting = {
  eid: string
  key?: string | null
  value?: string | null
}

// An agent session as yak keeps it. `session` is who it is and the status the
// host derives from its transcript; the rest are components beside it: `using`
// names the provider and model entities it runs on, `process` and `exit` the
// process behind it when it has one, and `created.at` when it began.
export type Session = {
  eid: string
  id: string
  actor?: string | null // who this run acts for
  operator?: boolean | null // receives project-wide attention
  standing?: string | null // log-derived: busy|terminal|idle
  status?: typeof sessionStates[number] | null // derived by the host
}
export type Using = {
  eid: string
  provider?: string | null // a provider entity
  model?: string | null // a model entity
  effort?: string | null
  instructions?: string | null
}
export type Process = {
  eid: string
  pid?: number | null
  command?: string | null
  cwd?: string | null
}

// Token counts a provider self-reported for a settled session, normalized to
// ONE vocabulary (Anthropic's field names) at the adapter — the browser and CLI
// read this shape, never a vendor's. Distinct from the per-entry `Usage`
// component below: this splits cache reads from cache writes (their prices
// differ 12×), which cost needs and `Usage.cached` conflates. Every field is
// optional ON PURPOSE: a count a provider never reported stays ABSENT, it never
// folds to 0 (absent beats zero — a missing number is not a free one). `input`
// is FRESH input only, cache reads/writes split out, so the four are comparable
// across providers even though each vendor slices its bill differently.
export type Tokens = {
  input?: number // fresh (uncached) input tokens
  cache_read?: number // input served from cache (Anthropic's discount tier)
  cache_creation?: number // input written to cache (Anthropic's premium tier)
  output?: number // generated tokens (reasoning included, as the bill counts it)
}

// One ordered Session-log entity. Every other log shape is a facet on this
// entity; seq is minted by the server within the Session partition.
export type Entry = { eid: string; session: string; seq: number }
// The ingest coordinate (D-16704): where an imported entry came from. `line`
// is the 1-based SOURCE line, distinct from entry.seq. Server-owned/immutable.
export type Imported = { eid: string; source: string; line: number }
export type Content = { eid: string; body: string }
export type Message = { eid: string; role: typeof messageRoles[number] }
export type Generation = {
  eid: string
  through: string
  provider: string
  model: string
  effort?: string | null
  serving_model?: string | null
}
export type Output = {
  eid: string
  source: string
  key?: string | null
  phase?: string | null
}
export type Call = { eid: string; key: string }
// Provider-neutral named tool use (D-16704): an imported tool call with no
// first-class facet keeps its real name and a one-line arg preview. The word
// is the transcript's own — @yaks/tools' `tool` is the registered tool ENTITY
// a call points at, and this is the block in the log that used one.
export type ToolUse = { eid: string; name: string; detail?: string | null }
export type Bash = { eid: string; command: string; cwd?: string | null }
export type Fetch = {
  eid: string
  url: string
  method: typeof httpMethods[number]
}
export type Patch = { eid: string; path: string; diff: string }
export type GraphQuery = { eid: string; query?: string | null }
export type ApplyComp = { eid: string; changes: string }
export type Result = { eid: string; call: string }
export type Exit = { eid: string; code: number }
export type ResponseComp = { eid: string; status: number }
export type Headers = { eid: string; data: string }
export type Stderr = { eid: string; text: string }
export type Brief = { eid: string; text: string }
export type Timeout = { eid: string; ms: number }
export type Checkpoint = { eid: string; through: string }
export type Recalled = { eid: string; source: string }
export type Cancel = { eid: string; target: string }
export type Opaque = { eid: string; format: string; data: string }
export type Runner = { eid: string; name: string }
export type Lease = {
  eid: string
  holder: string
  at: string
  until: string
}
export type Usage = {
  eid: string
  input: number
  cached: number
  output: number
  reasoning: number
}

// Desired fleet capacity. Runtime facts are server-stamped on the same row;
// sessions point back through role instead of a mutable current pointer.
export type Role = {
  eid: string
  state: string
  surface: string
  scope: string | null
  checkout?: string | null
  schedule?: string | null
  wake_policy?: string | null
  wake_target?: string | null
  applied_hash?: string | null
  applied_at?: string | null
  stopped_at?: string | null
  retry_at?: string | null
  quiet?: number | null
  cooldown?: number | null
  cap?: number | null
  decision?: string | null
  reason?: string | null
  observed?: string | null
  decided_at?: string | null
}

// What a session's life is read from: its own row, and the process behind
// it, which has an `exit` once it is gone.
export type Life = {
  session?: Session | null
  process?: Process | null
  exit?: Exit | null
}

// Is anybody home? A session whose transcript still asks for work is, and so
// is one whose process has not exited — a harness session announces itself
// with a pid and keeps no transcript for the host to read a status from.
export let awake = (e: Life) =>
  sessionActive.includes(String(e.session?.status)) ||
  (!!e.process?.pid && !e.exit)

// The word a session's pip and label wear. Between turns an awake session is
// idle; otherwise its status, or `running` while only its process says so. An
// ended one keeps its ending.
export let standing = (e: Life) =>
  awake(e) && e.session?.standing == 'idle'
    ? 'idle'
    : e.session?.status || (awake(e) ? 'running' : '')

// A session's lease on an entity — claims point at the session ENTITY.
// One claim per entity; taking one over another session's is a CONFLICT
// the server rejects — release first (comp: null), then claim.
export type Claim = { eid: string; session: string; at?: string }

// One task parked on one actor's interruption stack. rank preserves the
// nested claim order when one wrap releases several leases at the same time.
export type Resume = {
  eid: string
  actor: string
  at: string
  rank: number
}

// A request to stop the session it targets — the graph-native stop
// button. Created over the wire, acted on by the server's effect, kept
// as audit; acted_at is stamped when the signals have been sent.
// A stop signal, sent. It settles into `delivered` once the signals leave
// — no receipt column of its own; the audit row is the request.
export type StopRequest = { eid: string; target: string }

// An entity's mail address — the address-book facet, one comp for all.
export type Email = { eid: string; address: string }

// Addressing (D-14945): WHERE a deliverable goes. `to` names a graph
// entity — the recipient a knock/wake/outbound-mail is aimed at. Shared
// across the deliverable kinds, the intent half of the deliver/delivered/
// failed triad.
export type Deliver = { eid: string; to: string }

// A knock: the request column is the ask (what to look at); WHO looks is
// the `deliver {to}` facet, and the outcome the shared `delivered`/`failed`
// facet — neither a column here.
export type Knock = {
  eid: string
  target: string
}

// A knock waiting on the clock: `at` absolute (resolved at mint). WHO to
// wake is the `deliver {to}` facet; the outcome — the timer fired and
// minted the knock, or why it couldn't — is the shared `delivered`/`failed`
// facet. Neither a column here.
export type Wake = {
  eid: string
  at: string
  target?: string | null
  note?: string | null
}

// A dream: a venture's consolidation cursor. `scope` is the
// venture project it combs; `floor` the sliding cursor over sessions
// finished since. Both wire-writable — `task dream <project>` mints the
// entity; the comb advances the floor.
export type Dream = {
  eid: string
  scope?: string | null
  floor?: string | null
}

// Mail, either direction (@yaks/mail): `to` is the address, `at` when it
// was sent or arrived. An INBOUND mail carries message_id (also the
// never-send mark) and the edge's verified verdict.
export type Mail = {
  eid: string
  from?: string | null
  to?: string | null
  at?: string | null
  target?: string | null
  reply_to?: string | null
  message_id?: string | null
  verified?: boolean | null
  in_reply_to?: string | null
}

// The shared outcome and health facets (D-14945): `delivered` reached its
// destination (`via` says how — cast S-9 / spawned S-9 / local / a
// Message-ID), `failed` says an effect failed (`message` says why). The word
// is a MARK, beside `delivered`, because @yaks/tools spells a tool's own
// expected outcome `error{code}` and one word answers to one idea.
// Server-owned and effect-written; `.failed` is the fleet health query.
export type Delivered = { eid: string; at?: string | null; via?: string | null }
export type Failure = {
  eid: string
  at?: string | null
  message?: string | null
}

// The break facet (D-17077): an unexpected fault, the self-healing trigger.
// `stack` optional — a JS throw carries one, a died process may not.
export type Exception = {
  eid: string
  at?: string | null
  message?: string | null
  stack?: string | null
}

// The self-healing diagnosis facet (D-17077): a task auto-filed about an
// error, keyed for dedup and tallying its recurrences in place.
export type Bug = {
  eid: string
  fault?: string | null
  hits?: number | null
  last?: string | null
}

// The dream's dedup marker (T-17407): the shape key of a filed finding and its
// recurrence tally, riding on the consider-task or memory the finding became.
export type Finding = {
  eid: string
  key?: string | null
  hits?: number | null
  last?: string | null
}

// The block facet (D-17094): this task is stuck on an EXTERNAL thing with no
// entity. `on` is that free-text reason (wire-written); `since` is when it
// became blocked (server-stamped). The only thing that reddens the Dot.
export type Blocked = {
  eid: string
  on?: string | null
  since?: string | null
}

// The git-anchor facet (D-18378): the revision an entity was verified against.
// `paths` are repo-relative paths/globs (newline- or comma-separated); `sha`
// the commit last verified against; the exact tiers (D-21211) narrow the first
// path to a symbol, a hunk of raw text, and/or a 1-based inclusive line range.
// All wire-written; freshness is derived at read time by asking git, never
// stored.
export type Anchor = {
  eid: string
  paths?: string | null
  sha?: string | null
  symbol?: string | null
  hunk?: string | null
  start?: number | null
  end?: number | null
}

// A webhook delivery, pulled apart from the edge's raw request spool —
// all server-stamped (see `stamped`), payload kept verbatim.
export type Hook = {
  eid: string
  source?: string | null
  event?: string | null
  payload?: string | null
  spool_id?: string | null
  received_at?: string | null
  method?: string | null
  path?: string | null
  headers?: string | null
  sig_ok?: boolean | null
}

// A comment is a doc AIMED at something — and since target is any
// entity, ANYTHING is commentable: tasks, boards, frozen pages, other
// comments. Its actor and instrument ride the universal created stamp.
export type Comment = {
  eid: string
  target: string
}

// A commit: a git revision landed FOR its target (M-31946 §7) — the
// structured twin of a comment, with no doc: sha, repo and the whole
// message are columns; compact rows show the message's first line.
export type Commit = {
  eid: string
  target: string
  sha?: string
  repo?: string
  message?: string
}

// A signal: a doc EMITTED about its target, not said (D-13858). Same aim
// column as comment, and `event` names what happened; the words ride the
// doc. Delivered by the bus and inbox beside comments, but never a comment
// — off the mail relay, out of the conversation thread. The word is the
// fleet's because @yaks/session spells a passive transcript line `notice`.
export type Signal = {
  eid: string
  target: string
  event: string
}

// A verdict-bearing comment. The aim, rationale, and authorship stay on
// comment + doc + created; this component contributes only judgment.
export type Review = {
  eid: string
  verdict: string
}

// A claim that BOUNCED, kept as an entity: who tried (loser), who held
// (holder) — session references; a loser whose session was minted in the
// very batch that rolled back has no spine row and is null. Server-minted
// only; audit contention with graph_query kind=conflict.
export type Conflict = {
  eid: string
  target: string
  loser: string | null
  holder: string | null
  at?: string
}

// An audit entity for bytes deliberately removed from live doc state and its
// journal history. The created stamp carries when/by/via; only the digest of
// the removed value remains.
export type Redaction = {
  eid: string
  target: string
  column: 'title' | 'body'
  hash: string
}

// A value that names an entity, on an entity of its own: `key{of, value}`,
// beside a tag saying which kind of value it is (@yaks/key). `alias{}` is the
// tag for a name, a handle accepted wherever an id is (@yaks/alias); an entity
// may have several, each unique in the store.
export type Key = { eid: string; of: string; value: string }
export type Alias = { eid: string }

// The name an alias key gives and the entity it names — one reading for every
// resolution door (client.ts find, live.ts cache); undefined for any other
// row.
export let aliasOf = (
  c: { alias?: unknown; key?: { of?: unknown; value?: unknown } | null },
): { name: string; eid: string } | undefined =>
  c.alias && c.key?.value && c.key.of
    ? { name: String(c.key.value), eid: String(c.key.of) }
    : undefined

// A wearable voice: core text in the doc, tiers in the edges, home in
// home (null = fleet-shared).
export type Persona = { eid: string; home?: string | null }

// A model reified (D-21308): name is the wire spelling the session and
// generation string columns speak, vendor its maker, grade its tier.
export type Model = {
  eid: string
  name?: string | null
  vendor?: string | null
  grade?: string | null
}

// A tool a transcript's calls name (@yaks/tools `tool`).
export type Tool = { eid: string; name?: string | null }

// A distilled fact the fleet keeps: content in the doc, provenance in
// created, scope in scope (the project it belongs to; absent = a
// principle every operator carries). last_confirmed_at is the last explicit
// re-confirmation — server-stamped, like every recall statistic.
export type Memory = {
  eid: string
  scope?: string | null
  last_confirmed_at?: string | null
}

// A standing purpose (M-31946 §5): the doc carries the words, `scope` the
// project it guides (absent = fleet-wide). Never completed or reviewed —
// tasks `satisfies` it.
export type Goal = {
  eid: string
  scope?: string | null
}

// This entity records feedback; `by` is who gave it, absent when nobody
// wrote the source down. A facet — any entity may wear it.
export type Feedback = { eid: string; by?: string | null }

// Recall aggregates, server-minted on every activation.
// Three numbers are the whole model: query.ts hot() derives stability
// (count and spacing) and decays against last_at at read time — no
// stored score anywhere, nothing to sweep.
export type Recall = {
  eid: string
  count: number
  first_at: string
  last_at: string
}

// Provenance, paired when+who+how (T-6670/T-7113). `at` is server-frozen,
// `by` the actor (wire-writable for attribution), and `via` the server-stamped
// instrument. `created` is set once; `updated` is the last edit and is absent
// until the first modification after birth (absence = never edited).
export type Created = {
  eid: string
  at?: string
  by?: string | null
  via?: string | null
}
export type Updated = Created

// A moment stamped on an entity — the notification lifecycle (T-7006:
// presence records it, the whole stamp is server-frozen), `decided`, and
// `proposed` (the wire dates and signs them, the server names the instrument).
// Same shape as Created/Updated; absence is the earlier state (no `opened`
// row == unread, no `decided` row == nothing settled, no `proposed` row ==
// self-authorizing work). Read as pure Row-predicates, like unreadMail today.
export type Stamp = Created

// `decided` alone carries which way it went; absent verdict reads as
// approved (what pre-verdict rows meant when stamped).
export type Decided = Stamp & { verdict?: string | null }

// A full-text search hit. snip marks matches with \x01…\x02 (renderers
// highlight without trusting HTML); open is what to OPEN — the entity
// itself, or a comment's target.
export type Hit = {
  eid: string
  num: number
  kind: string
  title: string
  title_hit?: string
  snip: string
  score?: number // query-only relevance; larger ranks earlier
  open: string
  open_id?: string // open spoken (T-7) — only when it isn't the hit
  retired?: boolean // its project is over — the hit sank to the tail
}

// `ord` is an optional, editable listing order for the edge — a tie-break
// among members of one (parent, type) that share a rank. Only persona
// materialization reads it today (equal-warmth tier members list in a
// declared order, stable across databases and rewrites); every other edge
// leaves it null and behaves exactly as before. Lower sorts first.
export type Dep = { parent: string; type: Edge; child: string; ord?: number }

// An outgoing edge, verb + child — the Dependency view resolves the name.
export type Ref = { type: Edge; child: string }

// The bundle a renderer pattern-matches on: the entity plus whichever
// components it carries, its edge sentences, and the entities it
// contains. kind is derived (kindOf) — display convention, not data.
// EntCore is the CLOSED, precise face: one field per known component, each its
// exact type, plus the scalar spine (eid/num/kind) and edges (refs/kids). Ent
// (below) is the OPEN face the renderers see — a plugin's own component has no
// core field, so the index signature admits it (as `unknown`, the only element
// type that also tolerates the scalar spine in an object literal), enough to
// pattern-match with has() while every known comp keeps its precise type
// (intersection: T & unknown = T). The split is load-bearing: a bare index
// signature INSIDE this literal would collapse `keyof Ent` to `string`, so
// `Comps = Omit<Ent, …>` (live.ts) would lose every precise type. Applying the
// index signature by intersection over a closed core keeps both faces honest
// (D-18663 seam 2, T-12765 option 1). The richer option — derive EntCore from
// `comps` — is deferred to T-18672.
export type EntCore = {
  eid: string
  num: number
  kind: string
  doc?: Doc
  design?: { eid: string }
  goal?: Goal
  architecture?: { eid: string }
  task?: Task
  filed?: Filed
  accept?: Accept
  project?: ProjectTag
  venture?: Venture
  role?: Role
  person?: { eid: string }
  repo?: Repo
  canvas?: { eid: string }
  board?: BoardTag
  layout?: LayoutTag
  pane?: Pane
  web?: Web
  artifact?: Artifact
  attachment?: Attachment
  image?: Image
  card?: CardComp
  pin?: Pin
  client?: Client
  camera?: Camera
  fold?: Fold
  shelf?: Shelf
  cursor?: Cursor
  favorite?: Favorite
  setting?: Setting
  subscription?: {
    eid: string
    actor?: string | null
    target?: string | null
    mode?: (typeof subModes)[number]
  }
  chat?: { eid: string; actor?: string | null; target?: string | null }
  session?: Session
  using?: Using
  process?: Process
  brief?: Brief
  entry?: Entry
  imported?: Imported
  content?: Content
  message?: Message
  attention?: { eid: string }
  generation?: Generation
  output?: Output
  call?: Call
  tool_use?: ToolUse
  bash?: Bash
  fetch?: Fetch
  patch?: Patch
  task_context?: { eid: string }
  graph_query?: GraphQuery
  apply?: ApplyComp
  result?: Result
  exit?: Exit
  response?: ResponseComp
  headers?: Headers
  stderr?: Stderr
  timeout?: Timeout
  checkpoint?: Checkpoint
  cancel?: Cancel
  reasoning?: { eid: string }
  recalled?: Recalled
  opaque?: Opaque
  runner?: Runner
  lease?: Lease
  usage?: Usage
  claim?: Claim
  resume?: Resume
  stop_request?: StopRequest
  knock?: Knock
  wake?: Wake
  dream?: Dream
  mail?: Mail
  deliver?: Deliver
  hook?: Hook
  email?: Email
  conflict?: Conflict
  redaction?: Redaction
  comment?: Comment
  commit?: Commit
  signal?: Signal
  meta?: { eid: string }
  review?: Review
  alias?: Alias
  key?: Key
  memory?: Memory
  feedback?: Feedback
  persona?: Persona
  model?: Model
  tool?: Tool
  recall?: Recall
  created?: Created
  updated?: Updated
  notified?: Stamp
  opened?: Stamp
  archived?: Stamp
  quarantined?: Stamp
  decided?: Decided
  proposed?: Stamp
  delivered?: Delivered
  failed?: Failure
  exception?: Exception
  bug?: Bug
  finding?: Finding
  blocked?: Blocked
  anchor?: Anchor
  refs: Ref[]
  kids: Ent[]
}

// The open face: EntCore plus an index signature that admits a plugin's own
// components. `e.doc` stays precise; `e.invoice` (a plugin comp) typechecks as
// `unknown` — enough for has('invoice') to be a valid matcher; a plugin's own
// renderer narrows it. This is what widening has() to `string[]` relies on.
export type Ent = EntCore & { [comp: string]: unknown }

// A pin row joined to its card: where the card sits and what it shows.
export type Pinned = Pin & { target: string; view: string }

// The sync unit — one component patch landing on (or leaving) an entity. A
// batch is a flat array; a comp is a PATCH: omitted columns are untouched
// (a single prop change sends a single prop), `prop: null` clears that
// column, comp: null deletes the component, and {name: 'entity', comp: null}
// deletes the entity, its components, and every edge touching it. Deleting a
// bunch is just a long batch. Client-minted UUID eids are welcome — the
// spine (and its num) appears on first touch.
//
// An EDGE is an entity of its own, named by the sentence it says
// (edge.ts edgeEid): `edge{from, to}` beside the nature tag that is its
// verb, both written to link and both taken away to unlink. Both endpoints
// must exist. `edge.ord` is the listing order (types.ts Dep) — a patch on
// the same entity, never a second edge; omitting it leaves the stored one
// untouched.
// `was` is a PRECONDITION — the graph's --ff-only. It names the value the
// caller read, column by column (SHA-256 of it, or null for "I read no
// value"), and apply() refuses the whole batch if any guarded column has
// moved since. Per column, so a title edit never refuses an unrelated body
// write; a column absent from `was` is simply unguarded, which is every
// caller's behavior today. It rides BESIDE comp, never inside it: comp
// admits only real columns, so `doc.was` would be refused as alien.
//
// Riding beside comp is also why every hop from a client to apply() must
// SPREAD a change rather than rebuild it. Rewrite one as `{eid, name, comp}`
// and nothing breaks loudly — the guard just stops guarding, and the write
// lands unguarded while the caller believes it was protected. That is worse
// than never having had it.
export type Change = {
  eid: string
  name: string
  comp: Record<string, unknown> | null
  $num?: boolean
  was?: Record<string, string | null>
}

// A negotiated committed batch. The cursor makes the frame a complete
// IndexedDB checkpoint: a sole writer can land changes + cursor atomically.
export type Live = { live: Change[]; cursor: number }

// The whole graph in one gulp — a batch that fills an empty cache, plus the
// edges (edges aren't components; they ride alongside).
// `cursor` = the journal rowid this snapshot is current as of (a returning
// client's next delta `since`); `epoch`/`vocabHash` = the server-boot and
// vocabulary stamps a delta is validated against. OPTIONAL so the
// additions stay additive: snapshot() fills every field, but the many
// consumers that only read `changes`/`deps` (and build a bare {changes, deps}
// to feed notices/edgesOf/digests) stay valid Snapshots untouched.
export type Snapshot = {
  changes: Change[]
  deps: Dep[]
  cursor?: number
  epoch?: string
  vocabHash?: string
  capabilities?: string[]
}

// A page learns its host's vocabulary here, at the bottom of the module, so
// every module that imports this one evaluates with the tables full.
if (globalThis.document && !('Deno' in globalThis)) {
  learn(await (await fetch('/web/vocab.json')).json())
}
