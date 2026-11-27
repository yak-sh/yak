// A file's layout of its words. A component's table, its columns, indexes and
// views are named by the word's identity (@yaks/vocab `Vocab.stored`), so a
// rename moves nothing in storage. A file laid out before identities names
// them by label, and is read that way until it migrates.

import { labelStored, type Vocab } from '@yaks/vocab'
import { type Driver, fullLayout, relating, storeAs } from '@yaks/sql/core'
import { storedTables } from './physical.ts'
import { BESIDE, BRANCH, FROM, TO } from './history-shapes.ts'
import { BUILDING } from './layout.ts'

/** The vocabulary as a database keeps its words. An expand release keeps
 * an existing label layout until the migration moves it in one transaction. */
export let layoutOf = (v: Vocab, tables: readonly string[]): Vocab =>
  tables.some((name) =>
      name != 'entity' && !!v.comp(name) && v.stored(name) != name
    )
    ? labelStored(v)
    : v

/** Bind the vocabulary for all statements on this connection. */
export let bindStorage = (driver: Driver, v: Vocab): Vocab => {
  let layout = v
  if (identified(v)) {
    let current = driver.stored?.v
    let primary = historyLayout(v)
    let labels = labelStored(v)
    let known = current && fullLayout(current)
    layout = known == primary || known == labels
      ? known
      : historyLayout(layoutOf(v, storedTables(driver)))
  }
  storeAs(driver, layout)
  return layout
}

/** Whether a vocabulary can distinguish the two layouts. */
export let identified = (v: Vocab): boolean => {
  let held = identities.get(v)
  if (held == null) {
    identities.set(v, held = v.all.some((c) => v.stored(c) != c))
  }
  return held
}

let identities = new WeakMap<Vocab, boolean>()

let histories = new WeakMap<Vocab, Vocab>()

let historyLayout = (v: Vocab): Vocab => {
  if (!identified(v)) return v
  let held = histories.get(v)
  if (!held) {
    held = relating(
      v,
      v.all.flatMap((comp) =>
        v.comp(comp)?.computed || comp == 'entity' || comp == 'tombstone'
          ? []
          : [{
            name: comp + BESIDE,
            comp,
            suffix: BESIDE,
            columns: [BRANCH, FROM, TO],
          }, {
            name: BUILDING + comp,
            comp,
            prefix: BUILDING,
          }]
      ),
    )
    histories.set(v, held)
    histories.set(held, held)
  }
  return held
}

/** Compiled reads on a mode name the relations the mode supplies. */
export let readingVocab = (driver: Driver, layout: Vocab): Vocab => {
  if (driver.views) return labelStored(layout)
  let known = driver.stored?.v
  return known && fullLayout(known) == layout ? known : layout
}
