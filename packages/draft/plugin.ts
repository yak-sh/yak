// The package as a graph plugin: the two components, and the one hook that
// makes a draft safe to type into from two places at once.
//
// A draft's text is written whole, each time, by whichever interface the
// person is typing in. Two of them writing over the same text would each
// replace the other's, so each write says what it was typed over (the
// `typed{over}` event beside it), and the store merges: what is stored now,
// the text the writer started from, and what it wrote, made one by `merge`
// (./merge.ts), which never drops what either typed. Every write of the text
// also counts one more `rev`, so an interface hearing two answers keeps the
// newer. It runs inside the transaction, where what is stored now is what the
// write lands on.

import type { Bundle, Hook, Plugin } from '@yaks/graph'
import { derivedEid } from '@yaks/graph/identity'
import { after } from '@yaks/fp'
import { draftDoc } from './vocab.ts'
import { merge } from './merge.ts'

type Draft = { by?: string; text?: string | null; rev?: number }
type Writer = { saved?: number; text?: string; spent?: number }

let orderOf = (b: Bundle) => {
  let typed = b.typed as
    | { over?: string; writer?: string; order?: number; confirmed?: number }
    | undefined
  let { writer, order } = typed ?? {}
  if (writer == null || order == null) return
  return {
    eid: derivedEid(`draft writer|${b.entity.eid}|${writer}`),
    order,
    confirmed: typed?.confirmed,
  }
}

/**
 * The hook: each draft whose text is written is merged over what the store
 * holds when it says what it was typed over, and counted.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { graph } from '@yaks/graph'
 * import { ram } from '@yaks/ram'
 * import { loadVocab } from '@yaks/vocab'
 * import { draftDoc, drafts } from '@yaks/draft'
 *
 * let vocab = loadVocab([draftDoc])
 * let g = graph({ storage: ram(vocab), vocab, plugins: [drafts()] })
 * let write = (text: string, over: string) =>
 *   g.apply([{ entity: { eid: 'd' }, draft: { text }, typed: { over } }])
 * await write('ship it', '')
 * await write('ship it now', 'ship it') // one interface typed on
 * await write('Ship it', 'ship it') // another, not having heard it
 * let [d] = await g.get(['d'])
 * assertEquals(d.draft, { text: 'Ship it now', rev: 3 })
 * ```
 */
export let merging: Hook = (bundles, tx) => {
  let written = bundles.filter((b) =>
    typeof (b.draft as Draft | null)?.text == 'string'
  )
  if (!written.length) return bundles
  let orders = new Map(written.map((b) => [b, orderOf(b)]))
  let eids = written.flatMap((b) => {
    let writer = orders.get(b)
    return writer ? [b.entity.eid, writer.eid] : [b.entity.eid]
  })
  return after(tx.get(eids, ['draft', 'draft_writer']), (found) => {
    let held = new Map(
      found.map((b) => [b.entity.eid, (b.draft ?? {}) as Draft]),
    )
    let writers = new Map(
      found.map((b) => [b.entity.eid, b.draft_writer as Writer]),
    )
    return bundles.flatMap((b): Bundle[] => {
      let d = b.draft as Draft | null | undefined
      if (typeof d?.text != 'string') return [b]
      let now = held.get(b.entity.eid) ?? {}
      let over = (b.typed as { over?: string } | undefined)?.over
      let order = orders.get(b)
      let advanced: Bundle[] = []
      if (order) {
        let { eid, order: n, confirmed } = order
        let last = writers.get(eid) ?? {}
        let saved = last.saved ?? 0, spent = last.spent ?? 0
        if (n <= spent || (confirmed == null && n <= saved)) {
          return [{ ...b, draft: now }]
        }
        if (confirmed != null && saved > confirmed && saved < n) {
          over = last.text
        }
        let next = confirmed == null
          ? { ...last, saved: n, text: d.text }
          : { ...last, spent: n, ...(saved < n ? { text: '' } : {}) }
        writers.set(eid, next)
        advanced.push({
          entity: { eid },
          draft_writer: { ...next, draft: b.entity.eid, by: d.by },
          $actor: b.$actor,
        })
      }
      let text = over == null ? d.text : merge(over, d.text, now.text ?? '')
      let next = { ...d, text, rev: (now.rev ?? 0) + 1 }
      held.set(b.entity.eid, next)
      return [{ ...b, draft: next }, ...advanced]
    })
  })
}

/**
 * The draft plugin: `draft{by, place, text, rev}`, the `typed{over}` event,
 * and {@link merging}. Compose it wherever drafts are stored: the server an
 * interface writes to, or a page's own graph that keeps them itself.
 */
export let drafts = (): Plugin => ({
  name: '@yaks/draft',
  // Merging reads the transaction and rewrites its batch, with no external
  // effects. Admission can rehearse it without calling storage's writer.
  admission: () => true,
  vocab: [draftDoc],
  hooks: { precondition: merging },
})
