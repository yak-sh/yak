// The vocabulary codegen (D-22530 §6, T-22607): the SOURCE OF TRUTH is the
// per-plugin data manifests in ./manifests/*.json. This script reads those
// manifests and emits src/types.ts — the generated data section followed by
// the hand-written code half (code.ts.part) — plus fixture.json and the
// classified schema ops (store/schema.json). Composition is order-independent
// by construction: component and stamped-column order is derived ALPHABETICALLY
// (no consumer depends on a specific order — they iterate comps as a set), and
// kind precedence is DERIVED — an alphabetical base refined by local `before`
// constraints, topologically sorted into one total order — so independently
// authored plugins never collide over a hand-picked global integer. A comp name
// owned by two manifests still refuses loudly with both claimants named.
//
// Where a genuine FK/reference order is ever needed (none today), the mechanism
// is the same shape: a topological sort over the ref edges with alphabetical as
// the stable tiebreak — not a hand-assigned rank.
//
//   deno task codegen             regenerate types.ts + fixture.json +
//                                 store/schema.json from the manifests
//   deno task codegen --check     fail (exit 1) if the committed files are
//                                 stale against the manifests — the gate
//
// The emitted file is deno-fmt'ed via a subprocess so the stale check
// compares post-format bytes, never a formatting phantom.
import { capture } from './fixture.ts'

type ColSpec =
  | string
  | { enum: string | string[]; aliases?: Record<string, string> }
  | { eid: string; death: string }
  | { well: string }

type CompSpec = {
  wire?: boolean
  kind?: boolean
  before?: string[]
  prefix?: string
  by_name?: boolean
  lazy?: boolean
  log?: boolean
  plural?: string
  cols?: Record<string, ColSpec>
  stamped?: Record<string, ColSpec>
  indexes?: { cols: string[]; unique?: boolean; where?: string }[]
}

type Manifest = {
  name: string
  enums?: Record<string, { rank: number; values: string[] }>
  comps?: Record<string, CompSpec>
  renames?: Record<string, string>
  edges?: string[]
  governed?: string[]
  session_active?: string[]
  capabilities?: string[]
  session_facets?: string[]
}

let dir = new URL('.', import.meta.url).pathname

let refuse = (msg: string): never => {
  throw new Error(`vocab: ${msg}`)
}

export let typesStaleDiagnostic =
  'src/types.ts is stale against src/vocab/manifests/*.json — ' +
  'run `deno task codegen`'

// ---- load + compose -------------------------------------------------------

export let assemble = (manifests: Manifest[]) => {
  let compOwner: Record<string, string> = {}
  let enumOwner: Record<string, string> = {}
  let comps: Record<string, CompSpec & { plugin: string }> = {}
  let enums: Record<string, { rank: number; values: string[] }> = {}
  let renames: Record<string, string> = {}
  let edges: string[] | undefined
  let governed: string[] | undefined
  let sessionActive: string[] | undefined
  let capabilities: string[] | undefined
  let sessionFacets: string[] | undefined

  for (let m of manifests) {
    if (!m.name) refuse('a manifest is missing its name')
    for (let [name, spec] of Object.entries(m.comps ?? {})) {
      if (compOwner[name]) {
        refuse(
          `comp '${name}' claimed by both '${compOwner[name]}' and '${m.name}'`,
        )
      }
      compOwner[name] = m.name
      comps[name] = { ...spec, plugin: m.name }
    }
    for (let [name, spec] of Object.entries(m.enums ?? {})) {
      if (enumOwner[name]) {
        refuse(
          `enum '${name}' claimed by both '${enumOwner[name]}' and '${m.name}'`,
        )
      }
      enumOwner[name] = m.name
      enums[name] = spec
    }
    for (let [k, v] of Object.entries(m.renames ?? {})) {
      if (k in renames) refuse(`rename '${k}' declared twice`)
      renames[k] = v
    }
    let one = <T>(cur: T | undefined, next: T | undefined, what: string) => {
      if (cur != null && next != null) refuse(`${what} declared twice`)
      return next ?? cur
    }
    edges = one(edges, m.edges, 'edges')
    governed = one(governed, m.governed, 'governed')
    sessionActive = one(sessionActive, m.session_active, 'session_active')
    capabilities = one(capabilities, m.capabilities, 'capabilities')
    sessionFacets = one(sessionFacets, m.session_facets, 'session_facets')
  }

  // Component and stamped-column order are ALPHABETICAL: nothing outside this
  // file depends on a specific order (every consumer iterates comps as a set —
  // table creation, readable columns, death worklists), so the order only needs
  // to be deterministic and file-read-order independent.
  let wire = Object.entries(comps).filter(([, s]) => s.wire != false)
  let compOrder = wire.map(([n]) => n).sort()
  let logOrder = compOrder.filter((n) => comps[n].log)
  let stampedOrder = Object.entries(comps).filter(([, s]) => s.stamped)
    .map(([n]) => n).sort()

  // kind precedence is DERIVED, not hand-ranked: an alphabetical base refined by
  // local `before` constraints (a comp declares the kinds it beats), topo-sorted
  // into one total order — the most specific kind an entity carries names it
  // (kindOf). A priority topological sort emits the alphabetically-smallest kind
  // whose `before`-predecessors are all placed, so alphabetical is both the base
  // order and the tiebreak. A cycle in `before` refuses loudly.
  let kinds = Object.entries(comps).filter(([, s]) => s.kind).map(([n]) => n)
    .sort()
  let kindSet = new Set(kinds)
  let preds: Record<string, Set<string>> = {}
  for (let k of kinds) preds[k] = new Set()
  for (let k of kinds) {
    for (let x of comps[k].before ?? []) {
      if (!kindSet.has(x)) {
        refuse(`kind '${k}' declares before '${x}', which is not a kind`)
      }
      preds[x].add(k) // k before x ⇒ k is a predecessor of x
    }
  }
  let kindOrder: string[] = []
  let placed = new Set<string>()
  while (kindOrder.length < kinds.length) {
    let ready = kinds.find((k) =>
      !placed.has(k) && [...preds[k]].every((p) => placed.has(p))
    )
    if (!ready) return refuse('cycle in kind `before` constraints')
    kindOrder.push(ready)
    placed.add(ready)
  }

  // Named enum references must resolve.
  for (let [name, spec] of Object.entries(comps)) {
    for (
      let [col, t] of [
        ...Object.entries(spec.cols ?? {}),
        ...Object.entries(spec.stamped ?? {}),
      ]
    ) {
      if (
        typeof t == 'object' && 'enum' in t && typeof t.enum == 'string' &&
        !enums[t.enum]
      ) refuse(`${name}.${col} names unknown enum '${t.enum}'`)
    }
  }
  for (let name of governed ?? []) {
    if (!comps[name]) refuse(`governed comp '${name}' is not declared`)
  }

  return {
    comps,
    enums,
    renames,
    edges: edges ?? refuse('no manifest declares edges'),
    governed: governed ?? refuse('no manifest declares governed comps'),
    sessionActive: sessionActive ?? refuse('no session_active'),
    capabilities: capabilities ?? refuse('no capabilities'),
    sessionFacets: sessionFacets ?? refuse('no session_facets'),
    compOrder,
    logOrder,
    stampedOrder,
    kindOrder,
  }
}

// ---- emit -----------------------------------------------------------------

let q = (s: string) => `'${s.replaceAll("'", "\\'")}'`
let strList = (xs: string[]) => xs.map(q).join(', ')

let colValue = (t: ColSpec): string => {
  if (typeof t == 'string') return q(t)
  if ('eid' in t) return `{ eid: ${q(t.eid)}, death: ${q(t.death)} }`
  if ('well' in t) return `{ text: ${q(t.well)} }`
  if ('enum' in t) {
    let e = typeof t.enum == 'string' ? t.enum : `[${strList(t.enum)}]`
    if (!t.aliases) return `{ enum: ${e} }`
    let aliases = Object.entries(t.aliases)
      .map(([k, v]) => `${k}: ${q(v)}`).join(', ')
    return `{\n    enum: ${e},\n    aliases: { ${aliases} },\n  }`
  }
  return refuse(`unrecognized column spec ${JSON.stringify(t)}`)
}

let colBlock = (cols: Record<string, ColSpec>): string => {
  let keys = Object.keys(cols)
  if (!keys.length) return '{}'
  let rows = keys.map((k) => {
    let key = /^[A-Za-z_$][\w$]*$/.test(k) ? k : q(k)
    return `    ${key}: ${colValue(cols[k])},`
  })
  return `{\n${rows.join('\n')}\n  }`
}

export let emit = (a: ReturnType<typeof assemble>): string => {
  let out: string[] = []
  out.push(
    '// GENERATED — do not edit. The vocabulary source of truth is the',
    '// data manifests in src/vocab/manifests/*.json; `deno task codegen`',
    '// emits this file from them. Hand edits here are refused by the',
    "// gate's stale check",
    '// (`deno task codegen --check`). The code half is src/vocab/code.ts.part.',
    '//',
    '// Shared FE/BE vocabulary: entity components, edges, and the sync',
    '// unit. No imports; the module IS the schema, on both sides of the',
    '// wire.',
    '',
  )

  // Enums, rank order.
  let enumOrder = Object.entries(a.enums)
    .sort(([, x], [, y]) => x.rank - y.rank).map(([n]) => n)
  for (let name of enumOrder) {
    let { values } = a.enums[name]
    let line = `export let ${name} = [${strList(values)}] as const`
    if (line.length <= 80) out.push(line)
    else {
      out.push(
        `export let ${name} = [`,
        ...values.map((v) => `  ${q(v)},`),
        '] as const',
      )
    }
  }
  out.push('')

  // The Session-log vocabulary (the log comps, in comp order).
  out.push(
    '// The graph-native Session-log vocabulary (comps marked log = true).',
    'export let sessionComps: Record<string, Record<string, PropType>> = {',
  )
  for (let name of a.logOrder) {
    out.push(`  ${name}: ${colBlock(a.comps[name].cols ?? {})},`)
  }
  out.push('}', '')

  // comps — every wire-writable component, global rank order, log comps
  // expanded in place (value-identical to the old spread).
  out.push(
    '// The component tables, their wire-writable columns AND what each',
    '// column is — THE one list, assembled from the manifests.',
    'export let comps: Record<string, Record<string, PropType>> = {',
  )
  for (let name of a.compOrder) {
    out.push(`  ${name}: ${colBlock(a.comps[name].cols ?? {})},`)
  }
  out.push('}', '')

  // renames — kernel-owned, global, add-only.
  out.push(
    '// Old spellings that still resolve — the compatibility promise in',
    '// data. A rename ADDS a row and never removes one.',
    'export let renames: Record<string, string> = {',
  )
  for (let k of Object.keys(a.renames).sort()) {
    out.push(`  ${q(k)}: ${q(a.renames[k])},`)
  }
  out.push('}', '')

  // indexes — beyond what {eid} derivation reaches.
  out.push(
    '// Composite indexes and single-column overrides (see index.ts).',
    'export let indexes: Record<string, Idx[]> = {',
  )
  for (let name of a.compOrder) {
    let idx = a.comps[name].indexes
    if (!idx?.length) continue
    let rows = idx.map((i) => {
      let parts = [`cols: [${strList(i.cols)}]`]
      if (i.unique) parts.push('unique: true')
      if (i.where) parts.push(`where: ${q(i.where)}`)
      return `{ ${parts.join(', ')} }`
    })
    out.push(`  ${name}: [${rows.join(', ')}],`)
  }
  out.push('}', '')

  // partition — comps marked lazy.
  let lazies = a.compOrder.filter((n) => a.comps[n].lazy)
  out.push(
    '// Snapshot partition: lazy comps never ride the boot snapshot.',
    `export let partition: Record<string, 'eager' | 'lazy'> = {${
      lazies.map((n) => ` ${n}: 'lazy'`).join(',')
    } }`,
    '',
  )

  // stamped — server-owned columns.
  out.push(
    '// Server-stamped columns — never wire-writable, still schema.',
    'export let stamped: Record<string, Record<string, PropType>> = {',
  )
  for (let name of a.stampedOrder) {
    out.push(`  ${name}: ${colBlock(a.comps[name].stamped ?? {})},`)
  }
  out.push('}', '')

  // kindOrder / byName / prefix / plural irregulars.
  out.push(
    '// kind is DERIVED: the most specific component an entity carries',
    '// names it. Order derived alphabetically, refined by `before`.',
    'export let kindOrder = [',
    ...a.kindOrder.map((n) => `  ${q(n)},`),
    ']',
    '',
  )
  let byName = a.kindOrder.filter((n) => a.comps[n].by_name)
  out.push(
    '// Kinds whose doc title is a NAME a caller can type (near.ts).',
    `export let byName = new Set([${strList(byName)}])`,
    '',
  )
  out.push(
    '// The human id prefixes: curated for the kinds people type daily.',
    'export let prefix: Record<string, string> = {',
  )
  for (let name of a.compOrder) {
    let p = a.comps[name].prefix
    if (p) out.push(`  ${name}: ${q(p)},`)
  }
  out.push('}', '')
  let irregular = a.compOrder.filter((n) => a.comps[n].plural)
  out.push(
    'let irregular: Record<string, string> = {',
    ...irregular.map((n) => `  ${n}: ${q(a.comps[n].plural!)},`),
    '}',
    '',
  )

  // Edge vocabulary + one-off lists.
  out.push(
    '// The edge vocabulary — every edge reads as a sentence, parent',
    '// first. The list is the source of truth: db.ts bakes it into the',
    '// dependency check constraint.',
    'export let edges = [',
    ...a.edges.map((e) => `  ${q(e)},`),
    '] as const',
    '',
    '// Durable work/knowledge facets governed by project-rooted dependency paths.',
    `export let governed = [${strList(a.governed)}] as const`,
    '',
    '// A managed session is still going in exactly these statuses.',
    `export let sessionActive = [${strList(a.sessionActive)}]`,
    '',
    '// Server capability advertisements (see the sessions manifest).',
    `export let capabilities = [${strList(a.capabilities)}]`,
    `export let sessionFacetNames = [${strList(a.sessionFacets)}] as const`,
    '',
  )

  // The hand-written code half.
  let code = Deno.readTextFileSync(`${dir}code.ts.part`)
  out.push(code.trimEnd(), '')
  return out.join('\n')
}

// ---- schema classification ------------------------------------------------
// The ordered DDL a fresh src/db.ts migrate() runs, classified as SchemaOp and
// captured out-of-process (see captureSchema below) so it reflects the freshly-
// emitted types.ts. Written out as src/store/schema.json for a backend that
// plants at runtime and cannot capture the ops itself (workers/yak/store.ts).

type SchemaOp =
  | { kind: 'exec'; sql: string }
  | { kind: 'addColumn'; table: string; col: string; sql: string }
  | { kind: 'index'; name: string; sql: string }

// Capture the classified schema DDL in a SUBPROCESS reading the on-disk
// types.ts, so a vocabulary change lands in one codegen pass (importing db.ts
// here would bind a stale types.ts cached before this run rewrote it).
let captureSchema = async (): Promise<SchemaOp[]> => {
  let tmp = `${dir}.schema.tmp.json`
  let p = await new Deno.Command('deno', {
    args: [
      'run',
      '--allow-read',
      '--allow-write',
      '--allow-env',
      '--allow-ffi',
      '--unstable-net',
      `${dir}schema_capture.ts`,
      tmp,
    ],
    env: { DB_PATH: ':memory:', TASKS_SYNC: 'off' },
  }).output()
  if (!p.success) {
    refuse(`schema capture failed: ${new TextDecoder().decode(p.stderr)}`)
  }
  let ops = JSON.parse(Deno.readTextFileSync(tmp)) as SchemaOp[]
  Deno.removeSync(tmp)
  return ops
}

// ---- drive ----------------------------------------------------------------

let loadManifests = (): Manifest[] => {
  let mdir = `${dir}manifests/`
  let files = [...Deno.readDirSync(mdir)]
    .filter((f) => f.isFile && f.name.endsWith('.json'))
    .map((f) => f.name).sort()
  if (!files.length) {
    refuse('no manifests found in src/vocab/manifests/*.json')
  }
  return files.map((f) =>
    JSON.parse(Deno.readTextFileSync(mdir + f)) as Manifest
  )
}

let fmt = async (path: string) => {
  let p = await new Deno.Command('deno', { args: ['fmt', '-q', path] }).output()
  if (!p.success) {
    refuse(`deno fmt failed: ${new TextDecoder().decode(p.stderr)}`)
  }
}

if (import.meta.main) {
  let check = Deno.args.includes('--check')
  let assembled = assemble(loadManifests())
  let body = emit(assembled)
  let target = `${dir}../types.ts`
  // The temp file lives INSIDE the project so the fmt subprocess resolves
  // the project's deno.json (no-semis, single quotes) — /tmp would get
  // deno's defaults and the stale check would flap on formatting.
  let tmp = `${dir}.gen.tmp.ts`
  await Deno.writeTextFile(tmp, body)
  await fmt(tmp)
  let fresh = await Deno.readTextFile(tmp)
  let mod = await import(`file://${tmp}#${crypto.randomUUID()}`)
  let fixture = JSON.stringify(capture(mod), null, 2) + '\n'
  await Deno.remove(tmp)

  // The classified schema ops as JSON, for a backend that plants at runtime
  // and cannot capture them itself (a Durable Object has no scratch SQLite to
  // record a migrate() over): workers/yak imports it and hands it to plant().
  let opsTarget = `${dir}../store/schema.json`
  let opsJson = (ops: SchemaOp[]) => JSON.stringify(ops, null, 2) + '\n'

  let current = await Deno.readTextFile(target).catch(() => '')
  let currentFixture = await Deno.readTextFile(`${dir}fixture.json`)
    .catch(() => '')
  let currentOps = await Deno.readTextFile(opsTarget).catch(() => '')
  if (check) {
    if (current != fresh) {
      console.error(typesStaleDiagnostic)
      Deno.exit(1)
    }
    if (currentFixture != fixture) {
      console.error(
        'src/vocab/fixture.json is stale — run `deno task codegen`',
      )
      Deno.exit(1)
    }
    // types.ts on disk is now known-current, so the capture reflects it.
    let ops = await captureSchema()
    if (currentOps != opsJson(ops)) {
      console.error('src/store/schema.json is stale — run `deno task codegen`')
      Deno.exit(1)
    }
    console.log(
      'vocab: types.ts, fixture.json and store/schema.json match the manifests',
    )
  } else {
    // types.ts first, so the schema capture (a subprocess importing db.ts)
    // reads the freshly-emitted vocabulary its derived columns derive from.
    await Deno.writeTextFile(target, fresh)
    await Deno.writeTextFile(`${dir}fixture.json`, fixture)
    let ops = await captureSchema()
    await Deno.writeTextFile(opsTarget, opsJson(ops))
    console.log(
      `vocab: wrote types.ts (${fresh.length} bytes) + fixture.json + ` +
        `store/schema.json (${ops.length} ops)`,
    )
  }
}
