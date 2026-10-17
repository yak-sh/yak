// One-time T-127074 rekeying. Preserve integer spines: typed references,
// journal refs, FTS and vector rowids keep their exact targets. Rehearse on a
// snapshot; --apply commits, otherwise every change is rolled back.
import { derivedEid } from '@yaks/graph/identity'
import { configPath, read as readConfig } from '../packages/cli/config.ts'
import { words } from '../packages/cli/host.ts'
import { open } from '../packages/sqlite/db.ts'
import { reclassify } from '@yaks/sqlite'
import {
  and,
  col,
  cross,
  type Driver,
  eq,
  fn,
  gt,
  lit,
  oneOf,
  type Param,
  select,
  star,
  table,
  val,
} from '@yaks/sql'
import type { Vocab } from '@yaks/vocab'

export let validEid = (s: string): boolean =>
  /^(?:[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}|[\da-f]{40}|[\da-f]{64})$/i
    .test(s)
let assert = (yes: unknown, why: string): void => {
  if (!yes) throw new Error(why)
}
let pages = function* (
  db: Driver,
  name: string,
  key = 'entity',
  cols?: ReturnType<typeof col>[],
) {
  let after = 0
  while (true) {
    let page = db.query(
      select({
        from: table(name),
        cols,
        where: gt(col(key), lit(after)),
        order: [col(key)],
        limit: lit(1000),
      }),
    )
    if (!page.length) return
    yield page
    after = Number(page.at(-1)![key])
  }
}
let update = (
  db: Driver,
  name: string,
  key: string,
  id: Param,
  set: Record<string, Param>,
) =>
  db.query({
    t: 'update',
    table: name,
    set: Object.fromEntries(Object.entries(set).map(([k, v]) => [k, val(v)])),
    where: eq(col(key), val(id)),
  })
let count = (db: Driver, name: string) =>
  Number(
    Object.values(
      db.query(select({ cols: [fn('count', star())], from: table(name) }))[0],
    )[0],
  )

export let replacer = (mapping: Map<string, string>) => {
  let names = [...mapping.keys()].sort((a, b) => b.length - a.length)
  let escaped = names.map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  let pattern = escaped.length
    ? new RegExp(
      '(?<![A-Za-z0-9_-])(?:' + escaped.join('|') + ')(?![A-Za-z0-9_-])',
      'g',
    )
    : undefined
  return (s: string) =>
    pattern ? s.replace(pattern, (old) => mapping.get(old)!) : s
}
export let legacyEid = (
  old: string,
  replace: (s: string) => string,
): string => {
  if (old.startsWith('artifact:') && /^[\da-f]{64}$/i.test(old.slice(9))) {
    return old.slice(9)
  }
  let child = old.match(/^child:([\da-f-]{36})(.*)$/i)
  if (child) {
    return child[2]
      ? derivedEid(replace('child:' + child[1]) + replace(child[2]))
      : derivedEid('child:' + replace(child[1]))
  }
  let delivery = old.match(/^delivery:(child:[\da-f-]{36}|[\da-f-]{36}):(.*)$/i)
  if (delivery) {
    return derivedEid(
      'delivery:' + replace(delivery[1]) + ':' + replace(delivery[2]),
    )
  }
  if (old.startsWith('notice:')) {
    return derivedEid('notice:' + replace(old.slice(7)))
  }
  let output = old.match(/^output:([^:]+):(.*)$/)
  if (output) {
    return derivedEid('output:' + replace(output[1]) + ':' + output[2])
  }
  let suffix = old.match(/^([\da-f-]{36})(:.*|-letter)$/i)
  if (suffix) return derivedEid(replace(suffix[1]) + replace(suffix[2]))
  if (old.startsWith('viewport-')) {
    return derivedEid('viewport-' + replace(old.slice(9)))
  }
  return derivedEid('migrated-eid|' + old)
}
let ADDRESS = new Set([
  'eid',
  'eids',
  'id',
  'ids',
  'session',
  'sessions',
  'parent',
  'child',
  'target',
  'source',
  'to',
  'from',
  'by',
  'via',
  'actor',
  'call',
  'task',
  'tasks',
  'build',
  'builder',
  'machine',
  'artifact',
  'through',
  'reply_to',
  'project',
  'assignee',
  'home',
  'repository',
  'fork',
  'entry',
  'entity',
  'model',
  'provider',
  'persona',
  'scope',
  'owner',
  'person',
  'slot',
])
let PROSE = new Set([
  'prompt',
  'body',
  'text',
  'command',
  'instructions',
  'title',
  'description',
  'note',
  'reason',
  'said',
  'label',
  'name',
  'message',
  'question',
  'choice',
  'answer',
  'lyrics',
  'content',
])
export let structural = (
  value: unknown,
  mapping: Map<string, string>,
  replace = replacer(mapping),
  root = '',
): unknown => {
  let visit = (v: unknown, key: string): unknown => {
    if (PROSE.has(key)) return v
    if (typeof v == 'string') {
      if (['query', 'match', 'q'].includes(key)) return replace(v)
      if (ADDRESS.has(key)) return mapping.get(v) ?? v
      if (
        ['args', 'input', 'inputs', 'tasks', 'value', 'using'].includes(key) &&
        (v.startsWith('{') || v.startsWith('['))
      ) {
        try {
          let decoded = JSON.parse(v), next = visit(decoded, key)
          return JSON.stringify(decoded) == JSON.stringify(next)
            ? v
            : JSON.stringify(next)
        } catch { /*not JSON*/ }
      }
      return v
    }
    if (Array.isArray(v)) return v.map((x) => visit(x, key))
    if (v && typeof v == 'object') {
      return Object.fromEntries(
        Object.entries(v).map(([k, x]) => [mapping.get(k) ?? k, visit(x, k)]),
      )
    }
    return v
  }
  return visit(value, root)
}

// Journal after-images carry JSON text for scalar values. Integer ref columns
// already point through the unchanged spine. Only declared address-bearing
// fields enter this pass; doc/content/prose never enter it.
export let journalAddresses = (
  db: Driver,
  vocab: Vocab,
  mapping: Map<string, string>,
) => {
  if (!mapping.size) return 0
  let replace = replacer(mapping), moved = 0, after = 0
  let eligible = new Map<string, Map<string, string>>()
  for (let t of vocab.all) {
    let props = new Map<string, string>()
    for (let p of vocab.props(t)) {
      let d = vocab.prop(t, p)
      if (d?.category == 'ref') props.set(p, 'ref')
      else if (['json', 'jsonb', 'query'].includes(d?.scalar ?? '')) {
        props.set(p, d!.scalar!)
      }
    }
    if (t == 'key') props.set('value', 'query')
    if (t == 'context_output') props.set('source', 'ref')
    if (t == 'notice') props.set('task', 'ref')
    if (t == 'build' || t == 'built') {
      for (let p of ['match', 'inputs', 'key']) {
        props.set(p, p == 'key' ? 'query' : 'json')
      }
    }
    if (props.size) eligible.set(t, props)
  }
  let comps = [...eligible.keys()],
    fields = [...new Set([...eligible.values()].flatMap((p) => [...p.keys()]))]
  while (true) {
    let page = db.query(select({
      cols: [
        col('id', 'f'),
        col('value', 'f'),
        col('field', 'f'),
        col('component', 'c'),
      ],
      from: table('journal_field', 'f'),
      joins: [
        cross(table('journal_change', 'c')),
      ],
      where: and(
        gt(col('id', 'f'), val(after)),
        eq(col('id', 'c'), col('change', 'f')),
        oneOf(col('component', 'c'), comps),
        oneOf(col('field', 'f'), fields),
      ),
      order: [col('id', 'f')],
      limit: lit(2000),
    }))
    if (!page.length) break
    for (let r of page) {
      after = Number(r.id)
      let kind = eligible.get(String(r.component))?.get(String(r.field)),
        raw = r.value
      if (!kind || typeof raw != 'string' || replace(raw) == raw) continue
      let decoded = JSON.parse(raw), next: unknown
      if (kind == 'query') {
        next = typeof decoded == 'string' ? replace(decoded) : decoded
      } else if (kind == 'ref') {
        next = typeof decoded == 'string'
          ? (mapping.get(decoded) ?? decoded)
          : decoded
      } else next = structural(decoded, mapping, replace, String(r.field))
      if (JSON.stringify(decoded) == JSON.stringify(next)) continue
      update(db, 'journal_field', 'id', Number(r.id), {
        value: JSON.stringify(next),
      })
      moved++
    }
  }
  return moved
}

export let migrateEids = (
  db: Driver,
  vocab: Vocab,
  apply: boolean,
  prior = new Map<string, string>(),
) => {
  let started = performance.now()
  db.query({ t: 'begin', mode: 'immediate' })
  try {
    let tables = db.query({ t: 'pragma', name: 'table_list' }).filter((r) =>
        r.schema == 'main' && r.type == 'table' &&
        !String(r.name).startsWith('sqlite_')
      ).map((r) => String(r.name)).sort(),
      has = new Set(tables)
    let before = Object.fromEntries(tables.map((t) => [t, count(db, t)]))
    let invalid: string[] = [],
      spines = new Map<string, number>(),
      idCache = new Map<number, string>(),
      mapping = new Map<string, string>()
    let remember = (id: number, eid: string) => {
      idCache.set(id, eid)
      return eid
    }
    let id = (v: unknown): string => {
      let n = Number(v), held = idCache.get(n)
      if (held) return held
      if (idCache.size > 100000) {
        idCache = new Map([...idCache].filter(([, s]) => mapping.has(s)))
      }
      let row = db.query(
        select({
          cols: [col('eid')],
          from: table('entity'),
          where: eq(col('id'), val(n)),
        }),
      )[0]
      return row ? remember(n, String(row.eid)) : String(v)
    }
    for (let page of pages(db, 'entity', 'id', [col('id'), col('eid')])) {
      for (let r of page) {
        if (!validEid(String(r.eid))) {
          invalid.push(String(r.eid))
          spines.set(String(r.eid), Number(r.id))
          remember(Number(r.id), String(r.eid))
        }
      }
    }
    let tagNames = (kind: 'edge' | 'key') =>
      vocab.all.filter((t) => vocab.comp(t)?.keywords[kind] && has.has(t))
    let tag = (kind: 'edge' | 'key', entity: unknown) =>
      tagNames(kind).find((t) =>
        db.query(
          select({
            cols: [col('entity')],
            from: table(t),
            where: eq(col('entity'), val(Number(entity))),
          }),
        ).length
      )
    let collidingArtifacts = new Set(
      invalid.filter((old) =>
        old.startsWith('artifact:') &&
        db.query(
          select({
            cols: [col('id')],
            from: table('entity'),
            where: eq(col('eid'), val(old.slice(9))),
          }),
        ).length
      ),
    )
    let added = 0
    let add = (old: string, next: string) => {
      if (old == next) return
      if (mapping.get(old) != next) {
        mapping.set(old, next)
        added++
      }
    }
    for (let pass = 0; pass < 20; pass++) {
      added = 0
      console.error(
        'mapping pass',
        pass,
        Math.round(performance.now() - started),
        'ms',
      )
      let replace = replacer(mapping)
      for (let old of invalid) {
        add(
          old,
          collidingArtifacts.has(old)
            ? derivedEid('migrated-eid|' + old)
            : legacyEid(old, replace),
        )
      }
      // Re-derive a dependent identity only when an address in its inputs moved.
      // Page all inputs; retain only affected derivations, never the whole graph.
      let derive = (entity: unknown, sentence: string) => {
        let next = replace(sentence)
        if (next == sentence) return
        let old = id(entity)
        add(old, derivedEid(next))
        spines.set(old, Number(entity))
      }
      if (has.has('edge')) {
        for (let page of pages(db, 'edge')) {
          for (let r of page) {
            let from = id(r.from), to = id(r.to)
            if (mapping.has(from) || mapping.has(to)) {
              let kind = tag('edge', r.entity)
              assert(kind, `No edge tag ${r.entity}`)
              derive(r.entity, `${from}|${kind}|${to}`)
            }
          }
        }
      }
      if (has.has('key')) {
        for (let page of pages(db, 'key')) {
          for (let r of page) {
            let value = String(r.value)
            if (replace(value) != value) {
              let kind = tag('key', r.entity)
              assert(kind, `No key tag ${r.entity}`)
              derive(r.entity, `${kind}|${value}`)
            }
          }
        }
      }
      for (let t of vocab.all) {
        let props = vocab.identity(t)
        if (!props.length || !has.has(t)) continue
        for (let page of pages(db, t)) {
          for (let r of page) {
            let values = props.map((p) =>
              vocab.prop(t, p)?.category == 'ref'
                ? id(r[p])
                : String(r[p] ?? '')
            )
            if (values.every(Boolean)) {
              derive(r.entity, [t, ...values].join('|'))
            }
          }
        }
      }
      if (has.has('effect')) {
        for (
          let page of pages(db, 'effect', 'entity', [
            col('entity'),
            col('target'),
            col('handler'),
          ])
        ) {
          for (let r of page) {
            let target = id(r.target)
            if (mapping.has(target)) {
              let sentence = `effect|sweep|${r.handler}|${target}`
              if (id(r.entity) == derivedEid(sentence)) {
                derive(r.entity, sentence)
              }
            }
          }
        }
      }
      // Home rows identify the session whose machine they hold. Only test
      // known moved sessions; do not cross-product the full home catalogue.
      for (
        let old of invalid.filter((x) =>
          x.startsWith('child:') && !x.slice(6).includes(':')
        )
      ) {
        for (let prefix of ['session machine home ', 'native-fixer-machine|']) {
          let sentence = prefix + old, own = derivedEid(sentence)
          let r = db.query(
            select({
              cols: [col('id')],
              from: table('entity'),
              where: eq(col('eid'), val(own)),
            }),
          )[0]
          if (r) derive(r.id, sentence)
        }
      }
      if (!added) break
      assert(pass < 19, 'Derived identity mapping did not converge')
      // Cache only moved inputs and a bounded set of the most recent lookups.
      if (idCache.size > 100000) {
        idCache = new Map([...idCache].filter(([, s]) => mapping.has(s)))
      }
    }
    let targets = new Map<string, string>()
    for (let [old, next] of mapping) {
      assert(validEid(next), `Invalid target ${next}`)
      let existing = db.query(
        select({
          cols: [col('id')],
          from: table('entity'),
          where: eq(col('eid'), val(next)),
        }),
      )
      assert(!existing.length, `Existing target ${old} -> ${next}`)
      assert(
        !targets.has(next),
        `Colliding target ${old} and ${targets.get(next)}`,
      )
      targets.set(next, old)
      if (!spines.has(old)) {
        let row = db.query(
          select({
            cols: [col('id')],
            from: table('entity'),
            where: eq(col('eid'), val(old)),
          }),
        )[0]
        assert(row, `Missing ${old}`)
        spines.set(old, Number(row.id))
      }
    }
    console.error(
      'mapping complete',
      mapping.size,
      Math.round(performance.now() - started),
      'ms',
    )
    let replace = replacer(mapping), rewritten = 0
    for (let t of vocab.all) {
      if (!has.has(t)) continue
      let info = db.query({ t: 'pragma', name: 'table_info', arg: t })
      let props = info.filter((p) => {
        let name = String(p.name), d = vocab.prop(t, name)
        return name != 'entity' &&
          ((d?.category == 'ref' &&
            String(p.type).toLowerCase() != 'integer') ||
            ['json', 'jsonb', 'query'].includes(d?.scalar ?? '') ||
            (t == 'context_output' && name == 'source') ||
            (t == 'notice' && name == 'task') ||
            (t == 'key' && name == 'value') ||
            (t == 'build' && ['match', 'key', 'inputs'].includes(name)) ||
            (t == 'built' && ['key', 'inputs'].includes(name)))
      })
      if (!props.length) continue
      console.error('rewrite', t, Math.round(performance.now() - started), 'ms')
      for (
        let page of pages(db, t, 'entity', [
          col('entity'),
          ...props.map((p) => col(String(p.name))),
        ])
      ) {
        for (let r of page) {
          for (let p of props) {
            let name = String(p.name), d = vocab.prop(t, name), value = r[name]
            if (value == null) continue
            let json = ['json', 'jsonb'].includes(d?.scalar ?? ''),
              query = d?.scalar == 'query'
            if (json) {
              let decoded: unknown
              if (typeof value == 'string') {
                if (d?.scalar == 'json') {
                  try {
                    decoded = JSON.parse(value)
                  } catch {
                    decoded = value
                  }
                } else decoded = value
              } else if (value instanceof Uint8Array) {
                let out = Object.values(
                  db.query(select({ cols: [fn('json', val(value))] }))[0],
                )[0]
                decoded = out
              } else decoded = value
              let next = structural(decoded, mapping, replace, name)
              if (JSON.stringify(decoded) == JSON.stringify(next)) continue
              db.query({
                t: 'update',
                table: t,
                set: {
                  [name]: typeof value == 'string'
                    ? val(JSON.stringify(next))
                    : fn('jsonb', val(JSON.stringify(next))),
                },
                where: eq(col('entity'), val(Number(r.entity))),
              })
              rewritten++
            } else if (typeof value == 'string') {
              let next = (query || t == 'key' || t == 'build' || t == 'built')
                ? replace(value)
                : mapping.get(value) ?? value
              if (next != value) {
                update(db, t, 'entity', Number(r.entity), { [name]: next })
                rewritten++
              }
            }
          }
        }
      }
    }
    let addresses = new Map([...prior, ...mapping])
    let journalRewritten = journalAddresses(db, vocab, addresses)
    for (let [old, next] of mapping) {
      update(db, 'entity', 'id', spines.get(old)!, { eid: next })
    }
    let moved = [...mapping.values()]
    for (let at = 0; at < moved.length; at += 1000) {
      reclassify({ ...db, file: false }, moved.slice(at, at + 1000))
    }
    let after = Object.fromEntries(tables.map((t) => [t, count(db, t)]))
    for (let t of tables) {
      assert(
        before[t] == after[t],
        `Count changed ${t}: ${before[t]} -> ${after[t]}`,
      )
    }
    let remaining = 0
    for (let page of pages(db, 'entity', 'id', [col('id'), col('eid')])) {
      for (let r of page) {
        if (!validEid(String(r.eid))) remaining++
      }
    }
    assert(!remaining, `${remaining} invalid eids remain`)
    let result = {
      wallMs: Math.round(performance.now() - started),
      entities: before.entity,
      invalidBefore: invalid.length,
      invalidAfter: remaining,
      moved: mapping.size,
      rewrittenCells: rewritten,
      journalRewritten,
      counts: before,
      applied: apply,
    }
    db.query({ t: apply ? 'commit' : 'rollback' })
    return result
  } catch (e) {
    db.query({ t: 'rollback' })
    throw e
  }
}
if (import.meta.main) {
  let arg = (key: string) => Deno.args[Deno.args.indexOf(key) + 1]
  assert(Deno.args.includes('--db'), 'Explicit --db required')
  let path = arg('--db'),
    config = configPath(
      Deno.args.includes('--config') ? arg('--config') : undefined,
    )
  assert(config, 'No config found')
  let loaded = await words({ ...readConfig(config!), db: path, duties: false }),
    db = open(path)
  try {
    console.log(
      JSON.stringify(
        migrateEids(
          db,
          loaded.vocab,
          Deno.args.includes('--apply'),
          Deno.args.includes('--replay-map')
            ? new Map(
              Object.entries(
                JSON.parse(Deno.readTextFileSync(arg('--replay-map'))),
              ),
            )
            : new Map(),
        ),
      ),
    )
  } finally {
    db.close()
  }
}
