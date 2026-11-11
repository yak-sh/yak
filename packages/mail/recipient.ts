// The address a letter is for, kept with the letters. A letter's `mail` is read
// only by an app's owners and editors, but the `email{address}` row its
// `deliver.to` names carries no such mark, so in a public app anybody listed
// who had been written to. `email` itself cannot be kept (a public staff list
// uses it), so the row is marked when it is nothing but an address: a row the
// app also gave something of its own (`individual`, a form's `form_mail`) is
// left as the app wrote it.

import { type Bundle, type Eid, hook, merged, type Plugin } from '@yaks/graph'
import { comps } from '@yaks/graph/bundle'
import type { Tx } from '@yaks/graph/storage'
import { after, each } from '@yaks/fp'
import { and, eq } from '@yaks/query'
import { DELIVER, EMAIL, RECIPIENT } from './comp.ts'

// What the graph itself puts on a row, which is not the app's.
let STAMPS = ['created', 'updated']

/** Whether a row is only an address: it wears `email` and nothing of an app's
 * own. */
export let bare = (row: Bundle): boolean => {
  let names = comps(row).filter(([, c]) => c != null).map(([n]) => n)
  return names.includes(EMAIL) &&
    names.every((n) => n == EMAIL || n == RECIPIENT || STAMPS.includes(n))
}

let pointing = (tx: Tx, eid: Eid) =>
  tx.about ? tx.about([eid], [DELIVER]) : tx.read(and(eq(`${DELIVER}.to`, eid)))

// The `recipient` mark owed to the addresses this batch writes or names, as
// they will stand once it is written: an address a letter in the batch is for,
// or one in the batch that a stored letter is for. A store that answers
// without waiting is not made to wait: a batch that names no address is
// passed through as it came.
let marking = (bundles: Bundle[], tx: Tx): Bundle[] | Promise<Bundle[]> => {
  let named = new Set<Eid>(), written = new Set<Eid>()
  for (let b of bundles) {
    let to = (b[DELIVER] as { to?: unknown } | null | undefined)?.to
    if (typeof to == 'string') named.add(to)
    if (b[EMAIL]) written.add(b.entity.eid)
  }
  let eids = [...new Set([...named, ...written])]
  if (!eids.length) return bundles
  return after(
    tx.get(eids),
    (held) =>
      after(
        each(eids, [] as Bundle[], (marks, eid) => {
          let row = bundles.filter((b) => b.entity.eid == eid).reduce(
            merged,
            held.find((h) => h.entity.eid == eid) ?? null,
          )
          if (!row || row[RECIPIENT] || !bare(row)) return marks
          let mark = (lettered: boolean) =>
            lettered ? [...marks, { entity: { eid }, [RECIPIENT]: {} }] : marks
          return named.has(eid)
            ? mark(true)
            : after(pointing(tx, eid), (letters) => mark(letters.length > 0))
        }),
        (marks) => [...bundles, ...marks],
      ),
  )
}

/**
 * Marks the address a letter is for `recipient` when it is only an address, so
 * an app's owners and editors read it and a stranger does not.
 *
 * ```ts
 * import { graph } from '@yaks/graph'
 * import { ram } from '@yaks/ram'
 * import { loadVocab } from '@yaks/vocab'
 * import { mailDoc, recipients } from '@yaks/mail'
 * import { equal } from '@yaks/testing'
 *
 * let vocab = loadVocab([mailDoc])
 * let g = graph({ storage: ram(vocab), vocab, plugins: [recipients()] })
 * await g.apply([
 *   { entity: { eid: 'a' }, email: { address: 'ann@example.com' } },
 *   { entity: { eid: 'l' }, mail: {}, deliver: { to: 'a' } },
 * ])
 * equal((await g.read('.recipient')).map((b) => b.entity.eid), ['a'])
 * ```
 */
export let recipients = (): Plugin => ({
  name: '@yaks/mail/recipients',
  // It only adds a mark to the batch, so a check of a batch can run without it
  // writing.
  admission: () => true,
  hooks: { rules: hook([EMAIL, DELIVER], marking) },
})
