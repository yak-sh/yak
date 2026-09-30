/**
 * An `Edit`'s state, read live from the page's graph and changed there, and
 * the person's draft of its value, read and kept through the host's drafts.
 * One watch per graph; each instance's row is its own computed, so opening
 * one repaints it and whoever reads that one, nothing else. An `Edit` is open
 * while its state says so, or while the value has a draft that says
 * something else, so a draft typed anywhere shows wherever the value does.
 *
 * @module
 */

import { computed, type ReadonlySignal, signal } from '@preact/signals'
import { useMemo } from 'preact/hooks'
import type { Front } from './host.ts'
import { useHost, useOwner } from './host.ts'
import { at, place, put, type Row, source } from './state.ts'

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
 * row, the draft of its value, and the acts on them. */
export type Editing = {
  /** its eid in the page's graph */
  at: string
  /** its state, read live */
  row: Row | undefined
  /** the place its value's draft is typed in */
  place: string
  /** what is typed over the value and not yet sent ('' for nothing) */
  text: string
  /** being changed: its state says so, or its value's draft says something */
  open: boolean
  /** its state as the graph holds it now, for a handler that runs between
   * paints */
  now: () => Row | undefined
  /** open it */
  begin: () => void
  /** close it; the draft stays */
  end: () => void
  /** what is typed over the value: the draft */
  type: (text: string) => void
  /** the draft was sent, or put back: empty it */
  spend: () => void
  /** what is typed in its picker's search */
  search: (query: string) => void
}

/** The `Edit` that changes `comp.prop` of `eid` here: its state the one its
 * caller names (`at`), or the one derived from the owner above (host.ts
 * `Ux`); `value` is what the value holds now, which a draft saying the same
 * does not open. */
export let useEdit = (
  eid: string,
  comp: string,
  prop: string,
  { at: named, value }: { at?: string; value?: unknown } = {},
): Editing => {
  let { front, drafts } = useHost()
  let owner = useOwner()
  let me = named ?? at(owner, eid, comp, prop)
  let where = place(eid, comp, prop)
  let acts = useMemo(() => {
    let set = (patch: Row | null) => void front.mutate(put(me, patch))
    let now = () => front.ent(me)?.Edit as Row | undefined
    return {
      now,
      begin: () => set({ open: true }),
      end: () => now() && set(null),
      type: (text: string) => drafts.type(where, text),
      spend: () => drafts.spend(where),
      search: (query: string) => set({ query }),
    }
  }, [front, drafts, me, where])
  let row = rowsOf(front)(me).value
  let text = drafts.text(where)
  let open = !!row?.open || (!!text && text != source(value))
  return { at: me, row, place: where, text, open, ...acts }
}
