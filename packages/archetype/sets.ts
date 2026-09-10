import { sha256 } from '@yaks/graph'
import type { VocabDoc } from '@yaks/vocab'
import doc from './vocab.json' with { type: 'json' }

/** The archetype and retired components, loaded beside a host's vocabulary. */
export const archetypeDoc: VocabDoc = doc

/** A canonical table set with its full, portable SHA-256 entity id. */
export type Archetype = {
  readonly eid: string
  readonly tables: readonly string[]
}

/** Table presence only: all required tables and none of the excluded ones. */
export type Presence = { all?: readonly string[]; none?: readonly string[] }

/** UTF-8 bytewise order, independent of locale and JavaScript's UTF-16 sort. */
export function canonical(tables: Iterable<string>): string[] {
  let encoder = new TextEncoder()
  let entries = [...new Set(tables)].map((name) => {
    // The decided hash framing reserves |; refuse ambiguity rather than let
    // two different sets share an address. SQLite component names never use it.
    if (!name || name.includes('|') || name.includes('\0')) {
      throw new Error(`Invalid archetype table name: ${JSON.stringify(name)}`)
    }
    return { name, bytes: encoder.encode(name) }
  })
  entries.sort((a, b) => {
    for (let i = 0; i < Math.min(a.bytes.length, b.bytes.length); i++) {
      if (a.bytes[i] != b.bytes[i]) return a.bytes[i] - b.bytes[i]
    }
    return a.bytes.length - b.bytes.length
  })
  return entries.map((e) => e.name)
}

/** SHA-256 of the bytewise-sorted, de-duplicated table names joined with `|`. */
export function eidOf(tables: Iterable<string>): string {
  return sha256(canonical(tables).join('|'))
}

/** Decode the scalar wire/storage representation of archetype.tables. */
export function tablesOf(value: unknown): string[] {
  let list = typeof value == 'string' ? JSON.parse(value) : value
  if (!Array.isArray(list) || list.some((v) => typeof v != 'string')) {
    throw new Error('archetype.tables must be a JSON array of table names')
  }
  return canonical(list)
}

/** Whether a table set meets a presence predicate; no column values are read. */
export function satisfies(predicate: Presence, archetype: Archetype): boolean {
  return (predicate.all ?? []).every((t) => archetype.tables.includes(t)) &&
    !(predicate.none ?? []).some((t) => archetype.tables.includes(t))
}

/**
 * Process-local immutable set/transition/predicate cache. It caches CONTENT,
 * never a claim that a row committed: rollback and other writers cannot poison
 * it. Repeated moves use the (from, +/-table) edge without hashing again.
 */
export class Archetypes {
  private byEid = new Map<string, Archetype>()
  private bySet = new Map<string, Archetype>()
  private edges = new Map<string, Archetype>()
  private predicates = new Map<string, readonly string[]>()

  /** Look up a set already learned from the file or computed by this process. */
  get(eid: string): Archetype | undefined {
    return this.byEid.get(eid)
  }

  /** Intern a set, returning the very same immutable object on repeated use. */
  intern(tables: Iterable<string>): Archetype {
    let names = canonical(tables)
    let key = names.join('|')
    let found = this.bySet.get(key)
    if (found) return found
    let value = Object.freeze({
      eid: sha256(key),
      tables: Object.freeze(names),
    })
    this.bySet.set(key, value)
    this.byEid.set(value.eid, value)
    this.predicates.clear()
    return value
  }

  /** Add or remove one table; an already-satisfied move returns its source. */
  move(from: Archetype, table: string, add: boolean): Archetype {
    if (from.tables.includes(table) == add) return from
    let key = `${from.eid}${add ? '+' : '-'}${table}`
    let found = this.edges.get(key)
    if (found) return found
    let to = this.intern(
      add ? [...from.tables, table] : from.tables.filter((t) => t != table),
    )
    this.edges.set(key, to)
    this.edges.set(`${to.eid}${add ? '-' : '+'}${table}`, from)
    return to
  }

  /** Cached eids satisfying a predicate; learning a new set invalidates it. */
  matching(predicate: Presence): readonly string[] {
    let key = JSON.stringify([
      canonical(predicate.all ?? []),
      canonical(predicate.none ?? []),
    ])
    let found = this.predicates.get(key)
    if (found) return found
    let result = Object.freeze(
      [...this.byEid.values()].filter((a) => satisfies(predicate, a)).map((a) =>
        a.eid
      ),
    )
    this.predicates.set(key, result)
    return result
  }
}
