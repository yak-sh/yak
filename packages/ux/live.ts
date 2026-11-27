/**
 * An `Edit`'s state, read live from the page's graph and changed there, and
 * the person's draft of its value, read and kept through the host's drafts.
 * One watch per graph; each instance reads its own row of it, so opening
 * one repaints it and whoever reads that one, nothing else. An `Edit` is open
 * while its state says so, or while the value has a draft that says
 * something else, so a draft typed anywhere shows wherever the value does.
 *
 * @module
 */

import { useStore } from '@yaks/ui/store'
import { useMemo } from 'react'
import type { Front } from './host.ts'
import { type Drafts, useHost, useOwner } from './host.ts'
import { at, place, put, type Row, source } from './state.ts'

type Edits = {
  read: () => ReturnType<Front['watch']>['value']
  subscribe: (wake: () => void) => () => void
}

let held = new WeakMap<Front, Edits>()

// The `Edit` rows of one graph, watched once.
let editsOf = (front: Front): Edits => {
  let edits = held.get(front)
  if (edits) return edits
  let seen = front.watch('.Edit')
  edits = { read: () => seen.value, subscribe: (wake) => seen.subscribe(wake) }
  held.set(front, edits)
  return edits
}

// One snapshot for the two inputs that open an editor. Keep its identity
// while neither input changes, even when a different Edit row wakes the watch.
let editingAt = (
  edits: Edits,
  drafts: Drafts,
  address: () => string,
  place: string,
) => {
  let text = () => drafts.text(place)
  let snapshot: { row: Row | undefined; text: string } | undefined
  let read = () => {
    let rows = edits.read()
    let eid = rows.length ? address() : undefined
    let row = rows.find((b) => b.entity.eid == eid)?.Edit as Row | undefined
    let next = text()
    if (snapshot && snapshot.row === row && snapshot.text === next) {
      return snapshot
    }
    return snapshot = { row, text: next }
  }
  let subscribe = (wake: () => void) => {
    let offDraft = drafts.follow?.(() => {
      text()
      wake()
    })
    let offEdit = edits.subscribe(wake)
    return () => {
      offEdit()
      offDraft?.()
    }
  }
  return { read, subscribe }
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
  let where = place(eid, comp, prop)
  let { read, subscribe, address, ...acts } = useMemo(() => {
    // Resolve the edit's id when a row can exist or an action needs it.
    let key = named
    let address = () => key ??= at(owner, eid, comp, prop)
    let set = (patch: Row | null) => void front.mutate(put(address(), patch))
    let now = () => front.ent(address())?.Edit as Row | undefined
    return {
      ...editingAt(editsOf(front), drafts, address, where),
      address,
      now,
      begin: () => set({ open: true }),
      end: () => now() && set(null),
      type: (text: string) => drafts.type(where, text),
      spend: () => drafts.spend(where),
      search: (query: string) => set({ query }),
    }
  }, [front, drafts, named, owner, eid, comp, prop, where])
  let { row, text } = useStore(subscribe, read)
  let open = !!row?.open || (!!text && text != source(value))
  return {
    get at() {
      return address()
    },
    row,
    place: where,
    text,
    open,
    ...acts,
  }
}
