// The vocabulary codegen (D-22530 rung 1, T-22531): per-plugin TOML
// manifests in this directory are the SOURCE OF TRUTH for the graph
// vocabulary; this script assembles them and emits src/types.ts — the
// generated data section followed by the hand-written code half
// (code.ts.part). Composition is order-independent by construction:
// every ordered thing carries an explicit rank, ties refuse, and a comp
// name owned by two manifests refuses loudly with both claimants named.
//
//   deno task codegen          regenerate types.ts + fixture.json
//   deno task codegen --check  fail (exit 1) if the committed files are
//                              stale against the manifests — the gate
//
// The emitted file is deno-fmt'ed via a subprocess so the stale check
// compares post-format bytes, never a formatting phantom.
import { parse } from '@std/toml'
import { capture } from './fixture.ts'

type ColSpec =
  | string
  | { enum: string | string[]; aliases?: Record<string, string> }
  | { eid: string; death: string }
  | { well: string }

type CompSpec = {
  rank?: number
  wire?: boolean
  stamped_rank?: number
  kind_rank?: number
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
  session_active?: string[]
  capabilities?: string[]
  session_facets?: string[]
}

let dir = new URL('.', import.meta.url).pathname

let refuse = (msg: string): never => {
  throw new Error(`vocab: ${msg}`)
}

// ---- load + compose -------------------------------------------------------

export let assemble = (manifests: Manifest[]) => {
  let compOwner: Record<string, string> = {}
  let enumOwner: Record<string, string> = {}
  let comps: Record<string, CompSpec & { plugin: string }> = {}
  let enums: Record<string, { rank: number; values: string[] }> = {}
  let renames: Record<string, string> = {}
  let edges: string[] | undefined
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
    sessionActive = one(sessionActive, m.session_active, 'session_active')
    capabilities = one(capabilities, m.capabilities, 'capabilities')
    sessionFacets = one(sessionFacets, m.session_facets, 'session_facets')
  }

  // Ranks: explicit, unique — the global key order can never depend on
  // which file was read first.
  let byRank = (
    pairs: [string, number | undefined][],
    what: string,
  ): string[] => {
    let seen: Record<number, string> = {}
    for (let [name, rank] of pairs) {
      if (rank == null) return refuse(`${what} '${name}' has no rank`)
      if (seen[rank]) {
        refuse(`${what} rank ${rank}: '${seen[rank]}' vs '${name}'`)
      }
      seen[rank] = name
    }
    return pairs.sort((a, b) => a[1]! - b[1]!).map(([n]) => n)
  }

  let wire = Object.entries(comps).filter(([, s]) => s.wire != false)
  let compOrder = byRank(wire.map(([n, s]) => [n, s.rank]), 'comp')
  let logOrder = compOrder.filter((n) => comps[n].log)
  let stampedEntries = Object.entries(comps).filter(([, s]) => s.stamped)
  let stampedOrder = byRank(
    stampedEntries.map(([n, s]) => [n, s.stamped_rank]),
    'stamped comp',
  )
  let kindEntries = Object.entries(comps).filter(([, s]) => s.kind_rank != null)
  let kindOrder = byRank(
    kindEntries.map(([n, s]) => [n, s.kind_rank]),
    'kind',
  )

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

  return {
    comps,
    enums,
    renames,
    edges: edges ?? refuse('no manifest declares edges'),
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
    '// GENERATED from src/vocab/*.toml — edit the manifests, then run',
    "// `deno task codegen`. Hand edits here are refused by the gate's",
    '// stale check (`deno task codegen --check`). The prose that used to',
    '// live beside each declaration lives in the manifests now; the code',
    '// half of this module is src/vocab/code.ts.part.',
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
    '// names it. Rank order across the manifests.',
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

// ---- emit (Rust) ----------------------------------------------------------
// The kernel crate's vocabulary (T-22547): the same assembled contract,
// emitted as a `baked()` constructor for vocab::Vocab — native Rust data,
// no runtime JSON parse. Enum references resolve to their value lists here
// (the manifests are the only place names exist); aliases are a wire-side
// concern and do not ride into Rust, matching the fixture-parse behavior
// this replaces.

let rq = (s: string) => `"${s.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`

let rustProp = (t: ColSpec, enums: Record<string, { values: string[] }>) => {
  if (typeof t == 'string') {
    let named: Record<string, string> = {
      body: 'Body',
      number: 'Number',
      priority: 'Priority',
      bool: 'Bool',
      time: 'Time',
      url: 'Url',
      query: 'Query',
    }
    return `PropType::${named[t] ?? 'Text'}`
  }
  if ('eid' in t) return `PropType::Eid(${rq(t.eid)}.into())`
  if ('well' in t) return `PropType::Well(${rq(t.well)}.into())`
  if ('enum' in t) {
    let values = typeof t.enum == 'string'
      ? enums[t.enum]?.values ?? refuse(`unknown enum '${t.enum}'`)
      : t.enum
    let list = values.map((v) => `${rq(v)}.into()`).join(', ')
    return `PropType::Enum(vec![${list}])`
  }
  return refuse(`unrecognized column spec ${JSON.stringify(t)}`)
}

export let emitRust = (a: ReturnType<typeof assemble>): string => {
  let out: string[] = []
  out.push(
    '// GENERATED from src/vocab/*.toml — edit the manifests, then run',
    "// `deno task codegen`. Hand edits here are refused by the gate's",
    '// stale check (`deno task codegen --check`). One contract, three',
    '// faces: types.ts, fixture.json, and this module.',
    '',
    'use crate::vocab::{PropType, Vocab};',
    'use std::collections::HashMap;',
    '',
    'pub(crate) fn baked() -> Vocab {',
  )
  let colsRust = (cols: Record<string, ColSpec>) => {
    let rows = Object.entries(cols).map(([k, t]) =>
      `            (${rq(k)}.into(), ${rustProp(t, a.enums)}),`
    )
    return rows.length ? `vec![\n${rows.join('\n')}\n        ]` : 'vec![]'
  }
  out.push('    let comps = vec![')
  for (let name of a.compOrder) {
    out.push(
      `        (${rq(name)}.into(), ${colsRust(a.comps[name].cols ?? {})}),`,
    )
  }
  out.push('    ];')
  out.push('    let stamped = HashMap::from([')
  for (let name of a.stampedOrder) {
    out.push(
      `        (${rq(name)}.into(), ${colsRust(a.comps[name].stamped ?? {})}),`,
    )
  }
  out.push('    ]);')
  out.push('    let prefix = HashMap::from([')
  for (let name of a.compOrder) {
    let p = a.comps[name].prefix
    if (p) out.push(`        (${rq(name)}.into(), ${rq(p)}.into()),`)
  }
  out.push('    ]);')
  let strVec = (xs: string[]) =>
    `vec![${xs.map((x) => `${rq(x)}.into()`).join(', ')}]`
  out.push(`    let kind_order = ${strVec(a.kindOrder)};`)
  out.push(`    let statuses = ${strVec(a.enums.statuses.values)};`)
  out.push('    let renames = vec![')
  for (let k of Object.keys(a.renames).sort()) {
    out.push(`        (${rq(k)}.into(), ${rq(a.renames[k])}.into()),`)
  }
  out.push('    ];')
  // Death words, (comp, column, word) in declaration order — the write
  // path's cascade worklists (write.rs) derive from these, TS deaths().
  out.push('    let deaths = vec![')
  for (let name of a.compOrder) {
    for (let [col, t] of Object.entries(a.comps[name].cols ?? {})) {
      if (typeof t == 'object' && 'eid' in t) {
        out.push(
          `        (${rq(name)}.into(), ${rq(col)}.into(), ${
            rq(t.death)
          }.into()),`,
        )
      }
    }
  }
  out.push('    ];')
  out.push(`    let edges = ${strVec(a.edges)};`)
  // The session-log partition + facets — bare-prop routing (query.rs
  // route()) needs both, same derivations as sessionComps/sessionFacetNames.
  out.push(`    let session_comps = ${strVec(a.logOrder)};`)
  out.push(`    let session_facets = ${strVec(a.sessionFacets)};`)
  out.push(
    '    Vocab { comps, stamped, kind_order, prefix, statuses, renames, deaths, edges, session_comps, session_facets }',
    '}',
    '',
  )
  return out.join('\n')
}

// ---- drive ----------------------------------------------------------------

let loadManifests = (): Manifest[] => {
  let files = [...Deno.readDirSync(dir)]
    .filter((f) => f.isFile && f.name.endsWith('.toml'))
    .map((f) => f.name).sort()
  if (!files.length) refuse('no manifests found')
  return files.map((f) =>
    parse(Deno.readTextFileSync(dir + f)) as unknown as Manifest
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

  let rustTarget = `${dir}../../crates/yak-kernel/src/vocab_gen.rs`
  let rustBody = emitRust(assembled)

  let current = await Deno.readTextFile(target).catch(() => '')
  let currentFixture = await Deno.readTextFile(`${dir}fixture.json`)
    .catch(() => '')
  let currentRust = await Deno.readTextFile(rustTarget).catch(() => '')
  if (check) {
    if (current != fresh) {
      console.error(
        'src/types.ts is stale against src/vocab/*.toml — run `deno task codegen`',
      )
      Deno.exit(1)
    }
    if (currentFixture != fixture) {
      console.error(
        'src/vocab/fixture.json is stale — run `deno task codegen`',
      )
      Deno.exit(1)
    }
    if (currentRust != rustBody) {
      console.error(
        'crates/yak-kernel/src/vocab_gen.rs is stale — run `deno task codegen`',
      )
      Deno.exit(1)
    }
    console.log(
      'vocab: types.ts, fixture.json and vocab_gen.rs match the manifests',
    )
  } else {
    await Deno.writeTextFile(target, fresh)
    await Deno.writeTextFile(`${dir}fixture.json`, fixture)
    await Deno.writeTextFile(rustTarget, rustBody)
    console.log(
      `vocab: wrote types.ts (${fresh.length} bytes) + fixture.json + ` +
        `vocab_gen.rs (${rustBody.length} bytes)`,
    )
  }
}
