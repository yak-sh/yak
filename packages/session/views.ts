// How a transcript reads: one `Line` per entry, and a `Status` for the
// transcript itself, as portable @yaks/render renderers — the same tree prints
// as plain text in a CLI (@yaks/text) or mounts in a browser. The status is
// computed from the entries the caller hands in as `ctx.entries`, because a
// store with no derived columns (@yaks/ram) has nothing else to read it from.

import type { Comp } from '@yaks/graph'
import { parse } from '@yaks/query'
import { type Bundle, define, type Registry } from '@yaks/render'
import { SESSION } from './comp.ts'
import { ASK, CALL, ENTRY } from './native.ts'
import { kindOf, statusOf, textOf } from './status.ts'

let comp = (b: Bundle, name: string) => b[name] as Comp | undefined

/** What an ask or a call reached: `→ gpt-6-astra`, `→ echo`. The names are the
 * caller's (`ctx.names`, eid → name); a provider's anchor on an ask prints only
 * when the caller can read it (`ctx.anchor`), because which comp holds it is
 * the provider's business, not this view's. */
let reached = (
  b: Bundle,
  names: Record<string, string>,
  anchor?: (b: Bundle) => string | undefined,
) => {
  let to = comp(b, ASK)?.to ?? comp(b, CALL)?.to
  if (to == null) return ''
  let id = ASK in b ? anchor?.(b) : undefined
  return `→ ${names[String(to)] ?? String(to)}` +
    (id ? ` (${id.slice(0, 12)}…)` : '')
}

/** The transcript views: `Line` for an entry, `Status` for a transcript. The
 * context may carry `names` (model or tool eid → name), `anchor` (reads a
 * provider's anchor off an ask entry), and `entries` (the transcript, for
 * `Status`), and `full` (untruncated entry prose for transcript panes). */
export let views: Registry = define([
  {
    view: 'Line',
    match: parse(`.${ENTRY}`),
    render: (b, h, ctx) => {
      let e = comp(b, ENTRY)!
      let first = ctx.full ? textOf(b) : textOf(b).split('\n')[0].slice(0, 70)
      let names = (ctx.names ?? {}) as Record<string, string>
      let anchor = ctx.anchor as ((b: Bundle) => string | undefined) | undefined
      let line = [
        String(e.seq).padStart(3),
        (kindOf(b) ?? 'entry').padEnd(9),
        reached(b, names, anchor),
        first,
      ].filter(Boolean).join(' ')
      // Text hosts strip literal control bytes. Structural breaks preserve
      // transcript lines without letting other controls through.
      return h(
        'p',
        null,
        ...line.split('\n').flatMap((text, i) =>
          i ? [h('br', null), text] : [text]
        ),
      )
    },
  },
  {
    view: 'Status',
    match: parse(`.${SESSION}`),
    render: (b, h, ctx) => {
      let entries = (ctx.entries ?? []) as Bundle[]
      let name = String(comp(b, SESSION)?.id ?? b.entity.eid)
      return h('p', null, `${name}: ${statusOf(entries)}`)
    },
  },
])
