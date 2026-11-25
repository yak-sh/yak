/**
 * A person's conversation with a space's Operator, heard in the tab's page
 * graph (./operator-talk.ts) while the chat page shows it: the row the
 * Operator answers its line with, each time it moves, its reply as written
 * on `typing`. The page graph says where its tab is, and its door says it on
 * to that Operator for as long as the tab watches the conversation, so the
 * person watching is told there and not elsewhere.
 *
 * A conversation that is a view of its page (./talk-views.ts) is watched
 * only while that view shows: while Updates shows in its place the tab is
 * not on the Operator, which tells a reply in Updates and by push, as it
 * did when Updates was a page of its own. Shown again, the watch opens and
 * is answered whole, so the page reads what came meanwhile.
 *
 * @module
 */
import type { Client, Watch } from '@yaks/client'
import { pageGraph } from './page-graph.ts'
import {
  operatorTalk,
  operatorTalkWords,
  type Talk,
  type Told,
} from './operator-talk.ts'
import { VIEW, VIEWED } from './talk-views.ts'

/** What the conversation's row says. */
export type Heard = Talk & Told & { typing: string }

/** Where a conversation is heard: the tab's page graph, and the element it
 * is drawn in, watched only while the view that holds it shows. */
export type Hearing = { graph?: Pick<Client, 'watch' | 'wire'>; in?: Element }

/** `person`'s conversation `task` (none for a new chat) with the Operator of
 * the space `space`, watched while it is in view until it is closed. */
export let pageTalk = (
  space: string,
  person: string,
  task?: string,
  { graph = pageGraph([operatorTalkWords], person), in: at }: Hearing = {},
) => {
  let line = operatorTalk(space, task)
  let heard = new Set<(told: Heard) => void>()
  let watch: Watch | undefined, off: (() => void) | undefined
  let view = at?.closest<HTMLElement>(`[${VIEW}]`)
  let doc = at?.ownerDocument
  let closed = false
  let frame = view?.closest('[data-site-frame]')
  let showing = () => {
    if (closed) return
    let hidden = view?.hidden || frame?.hasAttribute('inert')
    if (hidden && watch) {
      off!()
      watch.close()
      watch = off = undefined
    } else if (!hidden && !watch) {
      watch = graph.watch(line)
      off = watch.subscribe(([row]) => {
        if (!row?.operatorTalk) return
        for (let fn of heard) fn(row.operatorTalk as Heard)
      })
    }
  }
  // An already mounted conversation can paint before its live watch opens.
  let activated = () => {
    let win = doc?.defaultView
    if (!frame?.hasAttribute('inert') && win?.requestAnimationFrame) {
      win.requestAnimationFrame(() => win.setTimeout(showing, 0))
    } else showing()
  }
  view?.addEventListener(VIEWED, showing)
  frame?.addEventListener(VIEWED, activated)
  showing()
  return {
    /** be told the row each time it moves, from now on */
    hear: (fn: (told: Heard) => void): () => void => {
      heard.add(fn)
      return () => void heard.delete(fn)
    },
    /** be told whether the page graph's socket is open now, and each time
     * it opens (true) or closes */
    connected: (fn: (open: boolean) => void): () => void => {
      let off = graph.wire?.onConnection(fn) ?? (() => {})
      fn(graph.wire?.connected() ?? false)
      return off
    },
    close: () => {
      closed = true
      view?.removeEventListener(VIEWED, showing)
      frame?.removeEventListener(VIEWED, activated)
      off?.()
      watch?.close()
      watch = off = undefined
    },
  }
}
