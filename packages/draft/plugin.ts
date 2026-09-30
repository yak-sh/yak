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
import { after } from '@yaks/fp'
import { draftDoc } from './vocab.ts'
import { merge } from './merge.ts'

type Draft = { text?: string | null; rev?: number }

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
  return after(tx.get(written.map((b) => b.entity.eid), ['draft']), (found) => {
    let held = new Map(
      found.map((b) => [b.entity.eid, (b.draft ?? {}) as Draft]),
    )
    return bundles.map((b): Bundle => {
      let d = b.draft as Draft | null | undefined
      if (typeof d?.text != 'string') return b
      let now = held.get(b.entity.eid) ?? {}
      let over = (b.typed as { over?: string } | undefined)?.over
      let text = over == null ? d.text : merge(over, d.text, now.text ?? '')
      let next = { ...d, text, rev: (now.rev ?? 0) + 1 }
      held.set(b.entity.eid, next)
      return { ...b, draft: next }
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
  vocab: [draftDoc],
  hooks: { precondition: merging },
})
