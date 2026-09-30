/**
 * An `Edit`'s state, read live from the page's graph and changed there. One
 * watch per graph; each instance's row is its own computed, so a keystroke
 * repaints the value being typed over and whoever reads that one, nothing
 * else.
 *
 * @module
 */

import { computed, type ReadonlySignal, signal } from '@preact/signals'
import { useMemo } from 'preact/hooks'
import type { Front } from './host.ts'
import { useHost, useOwner } from './host.ts'
import { at, put, type Row } from './state.ts'

type Rows = (eid: string) => ReadonlySignal<Row | undefined>

let held = new WeakMap<Front, Rows>()

// The rows of one graph, one computed per instance, made once.
let rowsOf = (front: Front): Rows => {
  let rows = held.get(front)
  if (rows) return rows
  let seen = front.watch('.Edit')
  let all = signal(seen.value)
  seen.subscribe((now) => all.value = now)
  let each = new Map<string, ReadonlySignal<Row | undefined>>()
  rows = (eid) => {
    let r = each.get(eid)
    if (!r) {
      r = computed(() =>
        all.value.find((b) => b.entity.eid == eid)?.Edit as Row | undefined
      )
      each.set(eid, r)
    }
    return r
  }
  held.set(front, rows)
  return rows
}

/** One `Edit`, as its owner and the component itself hold it: its eid, its
 * row, and the acts on it. */
export type Editing = {
  /** its eid in the page's graph */
  at: string
  /** its state, read live */
  row: Row | undefined
  /** its state as the graph holds it now, for a handler that runs between
   * paints */
  now: () => Row | undefined
  /** open it */
  begin: () => void
  /** close it, leaving nothing behind */
  end: () => void
  /** what is typed over the value */
  type: (text: string) => void
  /** what is typed in its picker's search */
  search: (query: string) => void
}

/** The `Edit` that changes `comp.prop` of `eid` here: `eid` the one its
 * caller names, or the one derived from the owner above (host.ts `Ux`). */
export let useEdit = (
  eid: string,
  comp: string,
  prop: string,
  named?: string,
): Editing => {
  let { front } = useHost()
  let owner = useOwner()
  let me = named ?? at(owner, eid, comp, prop)
  let acts = useMemo(() => {
    let set = (patch: Row | null) => void front.mutate(put(me, patch))
    let now = () => front.ent(me)?.Edit as Row | undefined
    return {
      now,
      begin: () => set({ open: true }),
      end: () => now() && set(null),
      type: (text: string) => set({ open: true, text }),
      search: (query: string) => set({ query }),
    }
  }, [front, me])
  return { at: me, row: rowsOf(front)(me).value, ...acts }
}
