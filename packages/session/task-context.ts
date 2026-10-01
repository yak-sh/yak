// A checkpoint freezes claimed task specifications. Later edits and claim
// changes are appended as context, never rewritten into the cached prefix.

import type { Bundle, Comp } from '@yaks/graph'
import type { Item } from '@yaks/model'
import { seqOf } from './status.ts'

export type Tasks = Record<string, { title?: string; body?: string }>

export let snapshot = (rows: Bundle[]): Tasks =>
  Object.fromEntries(
    rows.toSorted((a, b) => a.entity.eid.localeCompare(b.entity.eid)).map(
      (b) => {
        let doc = b.doc as Comp | undefined
        return [b.entity.eid, {
          ...doc?.title == null ? {} : { title: String(doc.title) },
          ...doc?.body == null ? {} : { body: String(doc.body) },
        }]
      },
    ),
  )

export let spec = (doc: Tasks[string]): string =>
  [doc.title, doc.body].filter((v) => v != null).join('\n\n')

export let items = (tasks: Tasks): Item[] =>
  Object.entries(tasks).map(([eid, doc]) => ({
    kind: 'instruction',
    text: 'Claimed task ' + eid + '\n' + spec(doc),
  }))

/** The newest admitted task set since this checkpoint, not live graph rows. */
export let admitted = (entries: Bundle[], checkpoint: Bundle): Tasks => {
  let later = entries.filter((b) =>
    seqOf(b) > seqOf(checkpoint) &&
    (b.task_context as Comp | undefined)?.checkpoint == checkpoint.entity.eid
  ).at(-1)
  return ((later?.task_context ?? checkpoint.checkpoint) as Comp)
    .tasks as Tasks ?? {}
}

/** New or edited specs in full, releases as explicit context corrections. */
export let changes = (before: Tasks, after: Tasks): string =>
  [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()
    .flatMap((eid) =>
      JSON.stringify(before[eid]) == JSON.stringify(after[eid])
        ? []
        : after[eid]
        ? ['Claimed task ' + eid + '\n' + spec(after[eid])]
        : ['Released task ' + eid + ': no longer claimed by this session.']
    ).join('\n\n')
