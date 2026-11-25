/**
 * A person's drafts in a space's Operator store, held in the tab's page
 * graph (D-475 step 4): the line `operatorDrafts(space)`, which the store
 * answers as a live read of the person (operator-api.ts) with each of their
 * drafts (@yaks/draft) marked `operatorDraft{space}`, so the page graph keeps
 * one space's drafts apart from another's. A write of drafts carries the
 * same mark, and the page graph's door sends it to that space's store
 * (reach-door.ts).
 *
 * @module
 */
import type { Bundle } from '@yaks/graph'
import type { VocabDoc } from '@yaks/vocab'
import type { Client } from '@yaks/client'
import type { Store } from '@yaks/draft/browser'

let LINE = /^\.operatorDraft\.space=([^&]+)&\*$/

/** The person's drafts in the Operator store of the space `eid`, whole: a
 * draft desk reads their `draft`. */
export let operatorDrafts = (eid: string): string =>
  `.operatorDraft.space=${eid}&*`

/** The space an `operatorDrafts` line asks about, or undefined for another
 * line. */
export let draftsSpace = (line: string): string | undefined =>
  LINE.exec(line)?.[1]

export let operatorDraftWords: VocabDoc = {
  $defs: {
    operatorDraft: {
      component: true,
      type: 'object',
      properties: { space: { type: 'string' } },
      required: ['space'],
    },
  },
}

/** The drafts `rows` of the space `space`, as its line answers them and a
 * write of them is sent. */
export let draftRows = (space: string, rows: Bundle[]): Bundle[] =>
  rows.map((r) => ({ ...r, operatorDraft: { space } }))

/** The space whose Operator store every one of `bundles` is written to, and
 * the bundles as the store takes them; undefined unless they all name the
 * same one. */
export let operatorWrite = (
  bundles: Bundle[],
): { space: string; bundles: Bundle[] } | undefined => {
  let spaces = new Set(
    bundles.map((b) => (b.operatorDraft as { space?: unknown })?.space),
  )
  let [space] = spaces
  if (spaces.size != 1 || typeof space != 'string') return undefined
  return {
    space,
    bundles: bundles.map(({ operatorDraft: _, ...b }) => b as Bundle),
  }
}

/** The Operator store of the space `space`, as a draft desk asks of a store
 * (@yaks/draft `Store`), through the page graph `graph`, for `person`. The
 * desk shows typing immediately. Send the entire write to the store for
 * merging, including the `typed` event that a local commit would consume. */
export let draftStore = (
  graph: Pick<Client, 'mutate' | 'watch'>,
  space: string,
  person: string,
): Store => ({
  me: () => Promise.resolve({ person }),
  apply: async (bundles) => ({
    bundles: await graph.mutate(draftRows(space, bundles), {
      optimistic: false,
    }),
  }),
  subscribe: (query, hear) => {
    let watch = graph.watch(query)
    let off = watch.subscribe(hear)
    if (watch.ready) hear(watch.value)
    return () => {
      off()
      watch.close()
    }
  },
})
