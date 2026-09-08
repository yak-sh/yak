// How a transcript reads: one `Line` per entry, and a `Status` for the
// transcript itself, as portable @yaks/render renderers — the same tree prints
// as plain text in a CLI (@yaks/text) or mounts in a browser. The status is
// computed from the entries the caller hands in as `ctx.entries`, because a
// store with no derived columns (@yaks/ram) has nothing else to read it from.

import type { Comp } from '@yaks/graph'
import { parse } from '@yaks/query'
import { type Bundle, define, type Registry } from '@yaks/render'
import { CALL, ENTRY, TRANSCRIPT } from './native.ts'
import { kindOf, statusOf } from './status.ts'

let comp = (b: Bundle, name: string) => b[name] as Comp | undefined

/** What a call entry reached: `→ model (id…)` or `→ <tool>`. */
let reached = (b: Bundle, names: Record<string, string>) => {
  let c = comp(b, CALL)
  if (!c) return ''
  if (c.source != null) return `→ ${names[String(c.to)] ?? String(c.to)}`
  let id = c.response_id ? ` (${String(c.response_id).slice(0, 12)}…)` : ''
  return `→ model${id}`
}

/** The transcript views: `Line` for an entry, `Status` for a transcript. The
 * context may carry `names` (tool eid → name) and `entries` (the transcript,
 * for `Status`). */
export let views: Registry = define([
  {
    view: 'Line',
    match: parse(`.${ENTRY}`),
    render: (b, h, ctx) => {
      let e = comp(b, ENTRY)!
      let first = String(e.text ?? '').split('\n')[0].slice(0, 70)
      let names = (ctx.names ?? {}) as Record<string, string>
      return h(
        'p',
        null,
        [
          String(e.seq).padStart(3),
          (kindOf(b) ?? 'entry').padEnd(9),
          reached(b, names),
          first,
        ].filter(Boolean).join(' '),
      )
    },
  },
  {
    view: 'Status',
    match: parse(`.${TRANSCRIPT}`),
    render: (b, h, ctx) => {
      let entries = (ctx.entries ?? []) as Bundle[]
      let name = String(comp(b, 'session')?.id ?? b.entity.eid)
      return h('p', null, `${name}: ${statusOf(entries)}`)
    },
  },
])
