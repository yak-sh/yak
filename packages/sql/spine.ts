// The two spines. Every entity the graph writes has a row in the entity table,
// and a query selects from that table. A computed component's entities do not
// (./derived.ts): they are rows of another package's tables, read through the
// backing it registers, and a query that asks for one reads those rows as its
// spine instead. This file is the dialect each spine is read through: the
// base dialect with every computed component read from its backing's rows and
// a reference to one of its entities read as that entity's eid, and, on a
// backing's spine, those rows standing where the entity table stood — the
// row's `entity` its owner, its eid written out from that id, nothing
// tombstoned and nothing numbered.
//
// The two id spaces only look alike: the journal's change 42 and entity 42
// share an integer and nothing else. So nothing here ever joins across them;
// the binder answers a clause about a component the spine never wears
// outright, instead of joining its table (./bind.ts `worn`).

import { field } from './sqlite.ts'
import type { Vocab } from '@yaks/vocab'
import { col, type Select, sub } from './ast.ts'
import { type Backings, eidAt, tagIn, type Tags } from './derived.ts'
import { inline, q } from './render.ts'
import type { Dialect } from './sqlite.ts'
import { Unsupported } from './unsupported.ts'

/** Whether a component is computed whole: no table of its own, its rows a
 * backing's. */
export let computed = (v: Vocab, comp: string): boolean =>
  !!v.comp(comp)?.computed

// Whether this vocabulary has a computed component at all: one that has none
// reads through its dialect unchanged. Asked on every bind, so kept per
// vocabulary.
let any = new WeakMap<Vocab, boolean>()
export let hasComputed = (v: Vocab): boolean => {
  let got = any.get(v)
  if (got == null) any.set(v, got = v.all.some((c) => computed(v, c)))
  return got
}

/** A backed component's rows, and the tag its eids carry in this store —
 * refused, never guessed at, when the store has not registered them. The rows
 * are written out when read, once per registry. */
export let backingOf = (backed: Backings, tags: Tags, comp: string) => {
  let b = backed[comp]
  if (!b) {
    throw new Unsupported('a computed component', `${comp} has no backing`)
  }
  if (!tags[comp]) {
    throw new Unsupported(
      'a computed component',
      `${comp}: this store has not tagged its entities`,
    )
  }
  return {
    get rows() {
      return written(b.rows)
    },
    tag: tags[comp],
  }
}
let texts = new WeakMap<Select, string>()
let written = (rows: Select): string => {
  let text = texts.get(rows)
  if (text == null) texts.set(rows, text = inline(sub(rows)))
  return text
}

/**
 * The dialect a query reads through, given the backings its store registered,
 * the tags it gives their eids and, when it reads a backing's rows as its
 * spine, that component. Each tag is read from the statement's own binding
 * (./derived.ts `tagIn`); `read` hears each component whose tag is, so the
 * statement binds it (`tagged`).
 */
export let backedDialect = (
  d: Dialect,
  v: Vocab,
  backed: Backings,
  tags: Tags,
  read: (comp: string) => void,
  spine?: string,
): Dialect => {
  if (!hasComputed(v)) return d
  let rows = (comp: string) => backingOf(backed, tags, comp).rows
  let tag = (comp: string) => {
    backingOf(backed, tags, comp)
    read(comp)
    return tagIn(comp)
  }
  // A reference column read as the eid it names: through the entity table for
  // an ordinary entity, written out from the id for a backed one.
  let refRead = (comp: string, prop: string): string | null => {
    let target = v.prop(comp, prop)?.ref
    return target && computed(v, target)
      ? inline(eidAt(tag(target), col(field(prop), comp)))
      : null
  }
  let base: Dialect = {
    ...d,
    table: (comp) =>
      computed(v, comp) ? `${rows(comp)} as ${q(comp)}` : d.table(comp),
    source: (comp) =>
      computed(v, comp) ? rows(comp) : d.source?.(comp) ?? q(comp),
    col: (comp, prop, vv) =>
      comp != 'entity' && refRead(comp, prop) || d.col(comp, prop, vv),
  }
  if (!spine) return base
  let owner = `${q(spine)}.${q('entity')}`
  let self = inline(eidAt(tag(spine), col('entity', spine)))
  return {
    ...base,
    spine: `${rows(spine)} as ${q(spine)}`,
    membership: `${self} as eid`,
    // A journal record is never deleted, and never tombstoned.
    live: () => ({ sql: '1', params: [] }),
    ownerKey: (b) => b == 'entity' ? owner : d.ownerKey(b),
    joinOn: (comp, b) =>
      `${q(comp)}.${q('entity')} = ${b == 'entity' ? owner : d.ownerKey(b)}`,
    // The spine's own identity: its eid, written out from the id. It has no
    // number and no archetype.
    col: (comp, prop, vv) =>
      comp == 'entity'
        ? prop == 'eid' ? self : 'null'
        : base.col(comp, prop, vv),
    archetype: undefined,
  }
}
