// How a transcript reads: one `Line` per entry, and a `Status` for the
// transcript itself, as portable @yaks/render renderers — the same tree prints
// as plain text in a CLI (@yaks/text) or mounts in a browser. The status is
// computed from the entries the caller hands in as `ctx.entries`, because a
// store with no derived properties (@yaks/ram) has nothing else to read it
// from.

import type { Comp } from '@yaks/graph'
import { parse } from '@yaks/query/core'
import {
  type Bundle,
  define,
  type Registry,
  type Rendering,
} from '@yaks/render'
import { passage, type Shown } from '@yaks/render/views'
import { SESSION } from './comp.ts'
import { ASK, CALL, ENTRY } from './native.ts'
import { kindOf, statusOf, textOf } from './state.ts'
import { asks, type Read, sessionName } from './name.ts'

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

let bound = (v: unknown) => {
  let n = Number(v)
  return Number.isSafeInteger(n) && n > 0 ? n : Infinity
}

// Full prose up to `maxLines` lines and `maxChars` characters; a cut says how
// long the whole is and the entry that holds it, one read away.
let preview = (b: Bundle, body: string, ctx: Record<string, unknown>) => {
  let lines = body.split('\n')
  let kept = lines.slice(0, bound(ctx.maxLines)).join('\n')
    .slice(0, bound(ctx.maxChars))
  return kept.length < body.length
    ? `${kept}\n… [${body.length} characters total; ${b.entity.eid}]`
    : body
}

/** Shared prose tree; renderers keep metadata structural rather than stripping
 * text. */
export let entryBody: Rendering = (b, h, ctx) => {
  let body = textOf(b)
  let first = ctx.full
    ? preview(b, body, ctx)
    : body.split('\n')[0].slice(0, 70)
  let names = (ctx.names ?? {}) as Record<string, string>
  let anchor = ctx.anchor as ((b: Bundle) => string | undefined) | undefined
  let line = [
    reached(b, names, anchor),
    first,
  ].filter(Boolean).join(' ')
  // Text renderers strip literal control bytes. Structural line breaks
  // preserve transcript lines without letting other control characters
  // through.
  return h(
    'span',
    null,
    ...line.split('\n').flatMap((text, i) =>
      i ? [h('br', null), text] : [text]
    ),
  )
}

let line: Rendering = (b, h, ctx) =>
  h(
    'p',
    null,
    String(comp(b, ENTRY)!.seq).padStart(3),
    ' ',
    (kindOf(b) ?? 'entry').padEnd(9),
    ' ',
    entryBody(b, h, ctx),
  )

// A transcript as one line of a list: the word that reaches it again, which
// every session tool takes (./who.ts `sessionFor`) — its number where it has
// one (`S-12`), else its runner's own id — and its status where the bundle
// carries one. A patch fresh from a write carries none, and a line that said
// "unknown" there would be wrong about a transcript that is fine.
let tile: Rendering = (b, h, ctx) => {
  let id = ctx.id as ((b: Bundle) => string) | undefined
  let status = comp(b, SESSION)?.status
  return h(
    'p',
    null,
    b.entity.num != null && id
      ? id(b)
      : String(comp(b, SESSION)?.id ?? b.entity.eid),
    ...status == null ? [] : [': ', String(status)],
  )
}

// A session as it is named wherever one is mentioned: by what it works on
// (./name.ts), read through the host's `query`, never by the command that
// launched it. A host that holds none of it names it by its id.
let title: Rendering = (b, h, ctx) => {
  let s = ctx as typeof ctx & Shown<unknown>
  let read = Object.fromEntries(
    Object.entries(asks(b.entity.eid)).map(([k, q]) => [k, s.query?.(q)]),
  ) as Read
  return h('span', null, sessionName(b, read) || s.id(b))
}

// What kind of words an entry's are, where they are not a person's or a
// model's prose: the same words a transcript says them by.
let labels: [string, string][] = [
  ['reasoning', 'reasoning'],
  ['prompt', 'instructions'],
  ['notice', 'context'],
  ['checkpoint', 'checkpoint'],
]
let what = (b: Bundle): string | undefined => {
  let kind = kindOf(b)
  if (kind == 'call' || kind == 'result') return `tool ${kind}`
  if (kind && kind != 'input' && kind != 'output') return kind
  return labels.find(([comp]) => comp in b)?.[1]
}

// Words said in a transcript, as one row of a list: who said them, when, the
// transcript they are in, and the passage around what was sought.
let said = passage({
  texts: (b) => [textOf(b)],
  what,
  where: (b) => {
    let session = comp(b, ENTRY)?.session
    return typeof session == 'string' ? ['in', session] : undefined
  },
})

/** The transcript views: `Line` for an entry, `Status` for a transcript. The
 * context may carry `names` (model or tool eid → name), `anchor` (reads a
 * provider's anchor off an ask entry), and `entries` (the transcript, for
 * `Status`), `full` (entry prose), `maxLines` and `maxChars` (bounds on that
 * prose's preview). In a list
 * of answers, words someone said in a transcript are a passage (`words`, the
 * words sought, marks them), any other entry's `Tile` is its line, and a
 * transcript's is its status as the store computed it. A transcript's `Title`
 * is its name (./name.ts), read through the host's `query`. */
export let sessionViews: Registry = define([
  { view: 'Line', match: parse('.entry'), render: line },
  {
    view: 'Tile',
    match: parse('.entry .created .content.body'),
    ...said,
  },
  { view: 'Tile', match: parse('.entry'), render: line },
  { view: 'Tile', match: parse(`.${SESSION}`), render: tile },
  // Named ahead of @yaks/process's `Title`, the command a process runs.
  { view: 'Title', match: parse(`.${SESSION}&?process`), render: title },
  { view: 'Body', match: parse('.entry'), render: entryBody },
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
