// Stored words and schema fitting, independent of a Durable Object host.
import { blobRead, blobSchema } from '@yaks/blob'
import {
  schema as vectorSchema,
  triggers as queueTriggers,
} from '@yaks/embedding'
import { type Field, fields, schema as ftsSchema } from '@yaks/fts'
import { sha256 } from '@yaks/graph/sha256'
import { ddl as journalDdl } from '@yaks/journal'
import {
  col,
  type CreateTable,
  type Derived,
  type Driver,
  eq,
  render,
  select,
  type Stmt,
  table,
  val,
} from '@yaks/sql'
import { FIT, printFor, printOf, schema } from '@yaks/sqlite'
import type { Vocab } from '@yaks/vocab'
import { GIT_STORE, PLATFORM_STORE } from './door.ts'
import {
  documented,
  INSTALL,
  passed,
  respelled,
  unholed,
  unworded,
} from './migrate.ts'
import { appDerived, appWords, storeWords } from './vocab.ts'
import { texts } from './embedding-read.ts'

let storeKind = (name: string) =>
  name == PLATFORM_STORE ? 'directory' : name == GIT_STORE ? 'git' : 'app'

/** What a store raises out of its words (`#build`): the words, whether it is
 * one of the platform's own two stores rather than an app, what its storage
 * reads a stored value through, which properties are searched, and the schema
 * as one word: its print (@yaks/sqlite `follow`), and the stamp an older
 * release kept in `yak_kv`, which a rollback still reads. The print and the
 * stamp render the whole schema, so they are made when first asked, which a
 * store whose schema this code already stood up never does (`#schema`).
 * `key` names the shape in every isolate: which store and which words. */
export type Shape = {
  words: ReturnType<typeof storeWords>
  vocab: Vocab
  own: boolean
  derived: Derived
  searchable: Field[]
  readonly print: string
  readonly stamp: string
  readonly ddl: Stmt[]
  /** what the store keeps over its component tables beside its own schema
   * (the search indexes and the embedding queue's triggers), made with a
   * component's table by its first write (@yaks/sqlite `over`) */
  readonly over: Stmt[]
  readonly key: string
}

// Fixed kinds and the core app shape live for this isolate. App declarations
// use a bounded cache; a burst of them cannot evict the fixed shapes. A shape
// is pure in which store it is and the `vocab.json` it holds, so a wake under
// cached words loads, renders and hashes nothing.
let shapes = new Map<string, Shape>()
let fixedShapes = new Map<string, Shape>()
let SHAPES = 16

// Whether a store is one of the platform's own two rather than an app's.
export let ownStore = (name: string) =>
  name == PLATFORM_STORE || name == GIT_STORE

export let shapeOf = (name: string, declared: string | null): Shape => {
  // Neither the directory nor the git object graph is an app: each speaks its
  // own words whatever it holds, so its name is the whole key.
  let own = ownStore(name)
  let fixed = own || declared == null || declared == '{}' ||
    declared == '{"$defs":{}}'
  let key = own ? name : fixed ? 'app' : `app ${declared}`
  let cache = fixed ? fixedShapes : shapes
  let held = cache.get(key)
  if (held) {
    if (!fixed) {
      cache.delete(key)
      cache.set(key, held)
    }
    return held
  }
  let words = own ? storeWords(storeKind(name)) : appWords(declared ?? {})
  let { vocab } = words
  let read = blobRead(vocab)
  let derived = { ...read, ...(own ? {} : appDerived(vocab, read)) }
  let searchable = fields(vocab)
  // The blob table first: the `doc_value` view and the search triggers read a
  // body's text out of it, so it has to be standing before they are.
  let after = () => [
    ...ftsSchema(searchable, read),
    ...vectorSchema(),
    ...(vocab.comp('_tx') ? journalDdl() : []),
  ]
  // The print is the box's (packages/cli/host.ts): the storage's own print,
  // which carries the revision of the fitting that brings standing tables to
  // it (@yaks/sqlite `FIT`), and every statement beside it. The stamp is the
  // same schema in the shape an older release kept, for a rollback to find.
  let print: string | undefined, stamp: string | undefined
  let ddl: Stmt[] | undefined, named: string | undefined
  let over: Stmt[] | undefined
  let shape: Shape = {
    words,
    vocab,
    own,
    derived,
    searchable,
    get print() {
      return print ??= printOf(`${INSTALL}:${printFor(vocab, derived)}`, [
        ...blobSchema(),
        ...after(),
      ])
    },
    get ddl() {
      return ddl ??= [...blobSchema(), ...schema(vocab, derived), ...after()]
    },
    get over() {
      return over ??= [
        ...ftsSchema(searchable, read),
        ...queueTriggers(texts(vocab, read)),
      ]
    },
    get stamp() {
      return stamp ??= sha256(
        [FIT, INSTALL, ...shape.ddl.map((s) => render(s).sql)].join('\n'),
      )
    },
    get key() {
      return named ??= sha256(key)
    },
  }
  cache.set(key, shape)
  if (shapes.size > SHAPES) shapes.delete(shapes.keys().next().value!)
  return shape
}

export let KV: CreateTable = {
  t: 'create table',
  name: 'yak_kv',
  ifNot: true,
  cols: [
    { name: 'k', type: 'text', pk: true },
    { name: 'v', type: 'text', notNull: true },
  ],
}

// What a schema pass is remembered by: the Worker version it ran under, the
// words it fitted and the stamp it left. A wake finding the same three renders
// no schema; one finding any moved asks the print again. A runtime that names
// no version remembers nothing.
export let fitOf = (
  version: string | null,
  key: string,
  schema: string | null,
): string | null => version && `${version} ${key} ${schema ?? ''}`
export let stands = (held: string | null, fit: string | null): boolean =>
  !!fit && held == fit

type Read = (key: string) => string | null
type Write = (key: string, value: string) => void

/** The Store's raw key/value slots, with a cache its transaction holder clears. */
export let slotsOf = <K extends string = string>(
  driver: () => Driver,
  cache = new Map<K, string | null>(),
) => ({
  read: (key: K): string | null => {
    if (cache.has(key)) return cache.get(key)!
    let [row] = driver().query(select({
      cols: [col('v')],
      from: table(KV.name),
      where: eq(col('k'), val(key)),
    }))
    let value = row ? String(row.v) : null
    cache.set(key, value)
    return value
  },
  write: (key: K, value: string) => {
    driver().query({
      t: 'insert',
      into: KV.name,
      cols: ['k', 'v'],
      rows: [[val(key), val(value)]],
      upsert: [{ on: [col('k')], set: { v: col('v', 'excluded') } }],
    })
    cache.set(key, value)
  },
})

/** Rewrite held declarations before any graph or schema reads them. */
export let reshapeSlots = (read: Read, write: Write) => {
  let shapes = [
    ['vocab', documented],
    ['tools', unholed],
    ['tools', unworded],
    ['tools', respelled],
  ] as const
  for (let [key, to] of shapes) {
    let held = read(key)
    let next = held && to(held)
    if (next) write(key, next)
  }
}

/** Fit the stored vocabulary over existing SQLite tables and retain its receipt. */
export let fitSchema = (
  driver: Driver,
  shape: Pick<Shape, 'vocab' | 'print' | 'stamp' | 'own' | 'key'>,
  read: Read,
  write: Write,
  version: () => string | null,
  report?: (error: Error, tags: Record<string, string>) => unknown,
): Error[] => {
  let held = read('schema')
  if (!(read('name') || held)) return []
  let fitted = () => fitOf(version(), shape.key, read('schema'))
  if (stands(read('fitted'), fitted())) return []
  let { left, stamp } = passed(driver, shape, held)
  if (stamp) write('schema', stamp)
  let fit = fitted()
  if (!left.length && fit) write('fitted', fit)
  if (report) {
    for (let e of left) {
      report(e, { request: 'schema fit', store: read('name') ?? '' })
    }
  }
  return left
}
