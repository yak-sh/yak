/**
 * The inbox views' own state: which threads are expanded and how the search
 * is switched. It is the page's, never the graph's, so it lives in a page
 * graph of the views' own (./front.json), a @yaks/client over RAM that no
 * server hears of, where a remount finds it again. What a person types is a
 * draft (@yaks/draft), kept everywhere, not this.
 *
 * @module
 */

import { type Client, client } from '@yaks/client'
import { derivedEid } from '@yaks/graph/identity'
import { useRows } from '@yaks/ux'
import { loadVocab, type VocabDoc } from '@yaks/vocab'
import doc from './front.json' with { type: 'json' }

let made: Client | undefined

/** The inbox views' page graph, made when a view first asks for it: a server
 * that imports the views to see what they offer never makes one. */
export let front = (): Client =>
  made ??= client(loadVocab([doc as VocabDoc]), [], {
    vault: false,
    wireVault: false,
    page: false,
  })

/** One view's state at a stable place, read live and changed in place: a
 * thread's (`thread:<eid>`) or a person's search (`search:<eid>`). */
export let usePage = <T extends Record<string, unknown>>(place: string) => {
  let eid = derivedEid(`inboxView|${place}`)
  let [state] = useRows(front(), `.inboxView .entity.eid=${eid}`)
  return {
    value: state?.inboxView as T | undefined,
    set: (value: Partial<T>) =>
      void front().mutate([{ entity: { eid }, inboxView: value }]),
  }
}
