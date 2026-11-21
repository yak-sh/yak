/**
 * How a conversation draws its lines, wherever one is shown: a person's words
 * as a bubble on their side, a reply as formatted text, each tool call as one
 * short line in plain words that opens on what it asked for and what came
 * back, a failure said in words with what went wrong inside a closed
 * "Details", a stop, and the files that came with a line ({@link files}).
 * Drawn with @yaks/ui's `Transcript`, `More`, `Pairs`, `Notice` and
 * `Attachments`, so it bundles for a server, a browser and the iOS shell
 * alike.
 *
 * Each kind of line is a {@link Kind}: a `Conversation.Line` registration
 * (@yaks/render) that matches on the components an entry wears, and draws it.
 * A host with words of its own (a channel's mark, a helper) puts its kinds
 * ahead of {@link kinds} in its own registry; the most specific match draws
 * the entry, and {@link draw} gives it to the next best when a kind passes.
 * What a view draws beside a line, outside its reading column, is a kind
 * registered under `Conversation.Margin` ({@link margin}): a view that loads
 * none draws its lines without one. Which renderers a view loads is the list
 * its registry is defined from. Which entries make a line is `joined`
 * (./lines.ts), which reads no kit.
 *
 * @module
 */

import { type ComponentChildren as Node, Fragment, h, type VNode } from 'preact'
import { useContext } from 'preact/hooks'
import { blocks, Host, type Options, parse } from '@yaks/markdown'
import {
  Attachments,
  Body,
  Logo,
  More,
  Notice,
  Pairs,
  Transcript,
} from '@yaks/ui/parts'
import { Fold } from '@yaks/ux/conversation'
import {
  type Bundle,
  define,
  type Registration,
  type Registry,
  resolve,
} from '@yaks/render'
import { parse as query } from '@yaks/query/core'
import { loadVocab } from '@yaks/vocab/runtime'
import { type Step, stepOf, type Steps } from '@yaks/tools/title'

export { type Joined, joined } from './joined.ts'

type Comp = Record<string, unknown>
let comp = (b: Bundle | undefined, name: string) =>
  b?.[name] as Comp | undefined
let body = (b?: Bundle) => String(comp(b, 'content')?.body ?? '')

let cut = (text: string, most: number) =>
  text.length > most ? text.slice(0, most) + '…' : text

/** A line as it is drawn: its parts, the words it says when copied where they
 * are not its entries' own (`text`), whether it is a step, which flows
 * beside the steps around it while closed, or the person's own words, which
 * sit on their side (`is`), and a step's tone: under way, or failed. */
export type Said = {
  node: Node
  text?: string
  is?: 'step' | 'theirs'
  tone?: Tone
}

/** A step's tone: under way (`on`) or failed (`no`). */
export type Tone = 'on' | 'no'

/** How a call reads to the person, by its tool's eid (`call.to`) and its
 * arguments: what it is doing while it runs and what it did once it answered
 * (@yaks/tools `stepOf`). */
export type Names = (tool: string, args?: Record<string, unknown>) => Called

/** How a call reads, and where the logo of the integration it names is drawn
 * from (@yaks/ui `Logo`): `null` for one with none, which wears the plug, and
 * absent where it names none. */
export type Called = Step & { logo?: string | null }

/** What a call's arguments name an integration by: its `integration`, or the
 * `connection` it attaches. */
export let integrationNamed = (
  args?: Record<string, unknown> | null,
): string | undefined =>
  [args?.integration, args?.connection].find((v): v is string =>
    typeof v == 'string' && !!v
  )

/** What a tool is called, of its `tool` component: its name, title and
 * steps (@yaks/tools `stepOf`). */
export type Named = { name?: string; title?: string; step?: Steps }

/** What the calls' steps are said from: each tool a call points at
 * (`call.to`) by its eid, as its `tool` component names it, and whom the
 * calls work for; and what the entities the lines' prose names are called,
 * by eid (`ids`, an entity's id such as `T-2`), drawn by {@link called}. */
export type Naming = {
  tools?: Record<string, Named>
  person?: string | null
  ids?: Record<string, string>
  /** where the logo of each integration a call names is drawn from, by what
   * it names it by ({@link integrationNamed}); `null` for one with none */
  logos?: Record<string, string | null>
}

/** How the calls read, from what names them. */
export let namer =
  ({ tools = {}, person, logos = {} }: Naming): Names => (tool, args) => {
    let step = stepOf(
      tools[tool] ?? { title: 'Use a tool' },
      args,
      person ? { person } : undefined,
    )
    let named = integrationNamed(args)
    return named != null && named in logos
      ? { ...step, logo: logos[named] }
      : step
  }

/** What a line is drawn with beside its entry: the result that answered it
 * when it is a call (`joined`), how calls read, what a call's step holds
 * after what it asked for (`under`), what came back of it drawn in place of
 * its result's own words (`came`: the helper a call started, not its id),
 * who works the conversation, as a sentence names them partway through
 * (`who`, "the Operator"), and whether the conversation is `stalled`: a
 * failure the host files to fix and then takes it up again on its own. */
export type Beside = {
  result?: Bundle
  names: Names
  under?: Node[]
  came?: Node[]
  who?: string
  stalled?: boolean
}

/** A kind of line: a `Conversation.Line` registration and what it draws of an
 * entry; `null` where the entry draws nothing, and `undefined` where this kind
 * passes it to the next best match. */
export type Kind<B extends Beside = Beside> = Registration & {
  draw: (b: Bundle, beside: B) => Said | null | undefined
}

/** The view every kind of line is registered under. */
export let LINE = 'Conversation.Line'

/** The view what a line has beside it is registered under: drawn outside
 * its reading column, of the entry the line is put by (an admin's sequence
 * and cost). */
export let MARGIN = 'Conversation.Margin'

// Every kind matches on which components an entry wears and on nothing they
// hold, and a vocabulary reads an undeclared name in a presence test as a
// component: kinds select the same under any vocabulary, so they need none.
let NONE = loadVocab([])

// An entry drawn in a view by the most specific kind registered under it
// that draws it.
let drawn = <B extends Beside>(
  view: string,
  registry: Registry<Kind<B>>,
  b: Bundle,
  beside: B,
): Said | null => {
  let pool = registry
  for (;;) {
    let kind = resolve(pool, b, view, NONE)
    if (!kind) return null
    let said = kind.draw(b, beside)
    if (said !== undefined) return said
    pool = { ...pool, renderers: pool.renderers.filter((k) => k != kind) }
  }
}

/** An entry drawn as its line, by the most specific kind that draws it. */
export let draw = <B extends Beside>(
  registry: Registry<Kind<B>>,
  b: Bundle,
  beside: B,
): Said | null => drawn(LINE, registry, b, beside)

/** What the line an entry is put by has beside it, by the most specific
 * margin kind that draws it; nothing where the registry loads none. */
export let margin = <B extends Beside>(
  registry: Registry<Kind<B>>,
  b: Bundle,
  beside: B,
): Node => drawn(MARGIN, registry, b, beside)?.node ?? null

/** Where the ids in a reader's Markdown open (@yaks/markdown `Host`): `url`,
 * with `{id}` where the id goes, as the reader's own server says; none, and
 * ids stay words. */
export let opening = (url?: string | null): Options =>
  url ? { refs: (id) => url.replaceAll('{id}', encodeURIComponent(id)) } : {}

/** Lines drawn with each eid their prose holds called as `ids` calls it,
 * else as the page's own Host does, else as its short handle; where the page
 * opens an id is the page's. */
export let called = (
  ids: Record<string, string> | undefined,
  node: Node,
): Node => ids && Object.keys(ids).length ? h(Called, { ids }, node) : node

let Called = (
  { ids, children }: { ids: Record<string, string>; children?: Node },
) => {
  let host = useContext(Host)
  let value = { ...host, ids: (eid: string) => ids[eid] ?? host.ids?.(eid) }
  return h(Host.Provider, { value }, children)
}

// A link whose words are its own address, a bare URL that slipped into the
// prose, as its host alone: https://yaks.app/approve?t=… reads "yaks.app".
let shortened = (href: unknown, kids: Node[]): Node[] => {
  let url = typeof href == 'string' && /^https?:/.test(href) &&
    URL.parse(href)
  return url && kids.flat().join('') == href
    ? [url.host.replace(/^www\./, '')]
    : kids
}

// An id that opens on another site opens in a tab of its own, so the page
// it was read on stays; a bare URL is drawn as its host (`shortened`).
let away =
  ((tag: string, props: Record<string, unknown> | null, ...kids: Node[]) =>
    h(
      tag,
      tag == 'a' && props?.['data-ref'] && /^https?:/.test(String(props.href))
        ? { ...props, target: '_blank', rel: 'noopener' }
        : props,
      ...tag == 'a' ? shortened(props?.href, kids) : kids,
    )) as typeof h

// The words, under the Refs of the page they are drawn on.
let Prose = ({ text }: { text: string }): VNode =>
  h(Fragment, null, ...blocks(parse(text), away, useContext(Host)))

/** Markdown drawn as formatted text, the kit's Body: markup in it stays
 * words, and an id is a link where the page's `Host` opens it
 * (@yaks/markdown). */
export let markdown = (text: string): VNode =>
  h(Body, { mod: 'flow' }, h(Prose, { text }))

/** A reply as it was written, in Markdown. */
export let reply = (text: string): VNode =>
  h(Transcript.Reply, {}, markdown(text))

/** A person's words, on their side. `mark` sits before them: how they came. */
export let yours = (text: string, mark?: Node): VNode =>
  h(Transcript.Bubble, {}, mark ?? null, text)

/** A file as a line names it: its name, and its media type where known. */
export type Sent = { name: string; mime?: string }

/** What a person said who sent files and no words. */
export let unsaid = (files: Sent[]): string =>
  'Attached: ' + files.map((f) => f.name).join(', ')

/** The kinds a browser draws as a picture, never a drawing that runs (SVG). */
export let PICTURES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']

/** Whether a file is words a browser shows as they are: text, and JSON,
 * XML and YAML. */
export let textual = (mime = ''): boolean =>
  /^text\/|^application\/(json|xml|yaml|x-yaml)$|\+(json|xml)$/.test(mime)

/** A file's kind as a person names it: its extension, else "File". */
export let fileKind = (name: string): string =>
  name.match(/\.([a-z0-9]{1,5})$/i)?.[1].toUpperCase() ?? 'File'

/** A size in bytes as a person reads it. */
export let fileSize = (n: number): string =>
  n < 1000
    ? `${n} B`
    : n < 1e6
    ? `${Math.round(n / 1e3)} KB`
    : `${(n / 1e6).toFixed(n < 1e7 ? 1 : 0)} MB`

/** A file as a conversation draws it, sent or held in a box to send: a
 * picture as itself, any other file as its kind and name. What differs is
 * given: where its original opens (`href`), a picture's source where that is
 * not it (`src`), and for one held, its `size`, a `note` and how to take it
 * back (`remove`, what its button carries). */
export type Filed = Sent & {
  href?: string
  src?: string
  size?: number
  note?: string
  remove?: Record<string, unknown>
}

/** One file, as `Filed` says. */
export let Filed = (
  { name, mime, href, src, size, note, remove }: Filed,
): VNode => {
  let away = remove
    ? h(Attachments.Remove, {
      type: 'button',
      'aria-label': `Remove ${name}`,
      ...remove,
    }, '✕')
    : null
  return PICTURES.includes(mime ?? '')
    ? h(
      Attachments.Picture,
      { href, target: href ? '_blank' : undefined },
      h(Attachments.Image, { src: src ?? href, alt: name, loading: 'lazy' }),
      away,
    )
    : h(
      Attachments.File,
      { href },
      h(Attachments.Kind, null, fileKind(name)),
      h(Attachments.Name, null, name),
      size == null ? null : h(Attachments.Size, null, fileSize(size)),
      note ? h(Attachments.Note, null, note) : null,
      away,
    )
}

/** A file opened where it is named, showing what it holds: a picture as
 * itself, words in a frame of their own that loads once it is seen (from its
 * `src`, a page of them, else its `href`), and any
 * other file as itself, which opens it. */
export let Shown = (file: Filed): VNode =>
  textual(file.mime) && file.href
    ? h(Attachments.Frame, {
      src: file.src ?? file.href,
      title: file.name,
      loading: 'lazy',
      sandbox: '',
    })
    : h(Attachments, null, h(Filed, file))

/** A file a step read or made, named in a quiet line that opens to what it
 * holds (`Shown`): "Read notes.txt". */
export let opened = (doing: string, file: Filed): VNode =>
  step(`${doing} ${file.name}`, '', h(Shown, file))

/** The files that came with a line, under it as a chat app shows them: a
 * person's sit at the `end`, on their side. None draws nothing. */
export let files = (sent: Filed[], mod?: 'end'): VNode | null =>
  sent.length ? h(Attachments, { mod }, sent.map((f) => h(Filed, f))) : null

/** The one way a conversation draws anything that opens: a step, by what it
 * did, opening on what it holds; `on` while it runs, `no` once it did not
 * work. A fold in a fold is the same fold. Whether it is open is its line's
 * fold state (@yaks/ux `Fold`), which a redrawn line keeps. */
export let step = (
  name: Node,
  mod: '' | Tone,
  ...inside: Node[]
): VNode => h(Fold, { mod: ['quiet', mod], summary: name }, ...inside) as VNode

/** A {@link step} whose inside is drawn only once it is opened (@yaks/ux
 * `Disclosure` `lazy`): what a model was told, say, which runs to tens of
 * kilobytes a step and is rarely opened. */
export let lazyStep = (
  name: Node,
  mod: '' | Tone,
  ...inside: Node[]
): VNode =>
  h(
    Fold,
    { mod: ['quiet', mod], summary: name, lazy: true },
    ...inside,
  ) as VNode

/** A value a tool was given or gave back, the way a person reads it: a list
 * of what it holds under names in words, never its JSON. Bounded in depth,
 * length and count, since a tool can answer with a whole file. */
export let readable = (value: unknown, depth = 0): Node => {
  if (typeof value == 'string' && /^\s*[[{]/.test(value)) {
    try {
      return readable(JSON.parse(value), depth)
    } catch {
      // Words that happen to start with a bracket.
    }
  }
  if (value == null || value === '') {
    return h(More.Value, {}, 'Nothing')
  }
  if (typeof value != 'object') {
    return h(More.Value, {}, cut(String(value), 600))
  }
  if (depth > 2) return h(More.Value, {}, '…')
  let list = Array.isArray(value)
    ? value.map((v, i) => [String(i + 1), v] as const)
    : Object.entries(value)
  if (!list.length) return h(More.Value, {}, 'Nothing')
  let more = list.length - 12
  return h(
    Pairs,
    { mod: 'nested' },
    list.slice(0, 12).map(([k, v]) =>
      h(
        Pairs.Row,
        {},
        h(
          Pairs.Key,
          {},
          Array.isArray(value)
            ? k
            : k.replace(/[_-]+/g, ' ').replace(/^./, (c) => c.toUpperCase()),
        ),
        h(Pairs.Value, {}, readable(v, depth + 1)),
      )
    ),
    more > 0 ? h(Pairs.Row, {}, h(Pairs.Value, {}, `and ${more} more`)) : null,
  )
}

// An error's own words, laid out to read: JSON indented, after the status a
// provider puts before it ("400 {…}").
let laid = (detail: unknown): string => {
  if (typeof detail != 'string') return JSON.stringify(detail, null, 2)
  let [, head, rest] = detail.match(/^(\d{3} )?\s*([[{][\s\S]*)$/) ?? []
  if (rest == null) return detail
  try {
    return (head ?? '') + JSON.stringify(JSON.parse(rest), null, 2)
  } catch {
    return detail
  }
}

/** The one way a conversation draws an error: what happened and what to do,
 * in words, with what the error said only inside a closed "Details". */
export let trouble = (said: string, detail?: unknown): VNode =>
  h(
    Transcript.Error,
    {},
    h(Notice, { mod: 'negative' }, said),
    detail == null || detail === '' ||
      (typeof detail == 'object' && !Object.keys(detail).length)
      ? null
      : step('Details', '', h(Body.Source, { mod: 'detail' }, laid(detail))),
  )

// Who works the conversation, partway through a sentence and at its start.
let who = (beside: Beside) => beside.who ?? 'the agent'
let Who = (beside: Beside) => who(beside).replace(/^./, (c) => c.toUpperCase())

// A step that did not work: "Tried texting Jeff".
let tried = (doing: string) =>
  'Tried ' + doing.replace(/…$/, '').replace(/^./, (c) => c.toLowerCase())

// A tool call and, once it came back, its answer, which takes the call's
// place: what it asked for, what came back, and what `under` adds between.
let tool = (call: Bundle, beside: Beside): Said => {
  let { result, names, under = [], came } = beside
  let c = comp(call, 'call')!
  let said = names(String(c.to), c.args as Record<string, unknown>)
  let ok = result ? !comp(result, 'refusal') && !result.exception : null
  let words = ok == null ? said.doing : ok ? said.done : tried(said.doing)
  let name = said.logo === undefined
    ? words
    : h(Logo, { src: said.logo ?? undefined }, words)
  let problem = `This step did not work, so ${who(beside)} went on without it.`
  return {
    node: step(
      name,
      ok == null ? 'on' : ok ? '' : 'no',
      h(More.Label, {}, 'What it asked for'),
      readable(c.args ?? {}),
      ...under,
      ok == null ? came ?? null : ok
        ? came ?? [
          h(More.Label, {}, 'What came back'),
          readable(body(result)),
        ]
        : trouble(
          problem,
          comp(result, 'content')?.body ?? result!.exception ??
            comp(result, 'refusal'),
        ),
    ),
    text: ok === false ? `${words}\n\n${problem}` : undefined,
    is: 'step',
    ...ok ? {} : { tone: ok == null ? 'on' : 'no' },
  }
}

// Words said in plain words. What a provider or the host said of a failure
// is never a person's to read: it is the host's tracker's (./answer.ts
// `replyOf` says it as `fault`), and the transcript keeps it for agents.
let failure = (said: string): Said => ({ node: trouble(said), text: said })

// A ceiling met (./state.ts `LIMIT`): said in the host's own sentence, which
// is the line's words.
let LIMIT = 'limit'

// What comes of a stop: the conversation is taken up again once its fault
// is fixed where it stalled, else the person sends again.
let after = (beside: Beside) =>
  beside.stalled
    ? 'It will be taken up again once the problem is fixed.'
    : 'Send your message again to try once more.'

// A provider's refusal, or the host's own ceiling in its words.
let refused = (b: Bundle, beside: Beside) =>
  comp(b, 'refusal')?.code == LIMIT && body(b)
    ? { node: reply(body(b)) }
    : failure(
      `${
        Who(beside)
      } could not get an answer from its model, so it stopped before replying. ${
        after(beside)
      }`,
    )

let failed = (beside: Beside) =>
  failure(
    `Something went wrong, and ${who(beside)} stopped before it finished. ${
      after(beside)
    }`,
  )

// A model's answer cut off on the way (the provider dropped it, or no longer
// held what it continued from): the turn goes on, or ends on its own line.
let interrupted = (beside: Beside): Said => ({
  node: h(Notice, {}, `${Who(beside)}'s answer was interrupted.`),
})

let stopped = (): Said => ({ node: h(Notice, {}, 'Stopped.') })

/** What a model said of its reasoning: a quiet step among its tool calls,
 * opening on its words, so an answer never appears from nowhere. */
export let thought = (b: Bundle): Said | undefined =>
  body(b).trim()
    ? { node: step('Thought it through', '', markdown(body(b))), is: 'step' }
    : undefined

/** What a transcript's kinds are that are none of the person's words. */
export let NOT_INPUT = [
  'operator_stopped',
  'output',
  'result',
  'refusal',
  'exception',
  'notice',
  'task_context',
  'failed',
  'stop',
  'interrupted',
  'call',
  'reasoning',
  'ask',
  'prompt',
  'tool_progress',
]

/** A person's own words: an entry with words that is none of the other
 * kinds. */
export let theirs = (b: Bundle): boolean =>
  !!comp(b, 'content')?.body && !NOT_INPUT.some((c) => b[c])

/** What a person wrote. A task's first input is the task itself as JSON (its
 * row, and on older sessions its comments): its body is what they wrote. */
export let words = (said: string): string => {
  if (said.startsWith('{')) {
    try {
      let task = JSON.parse(said).task
      let doc = task?.doc ?? task
      if (typeof doc?.body == 'string') return doc.body
    } catch {
      // Not the task: words that happen to start with a brace.
    }
  }
  return said
}

/** A kind drawn by `draw`, matching `match` (a query of which components
 * an entry wears), or any entry where it is empty: a kind of line, or under
 * `view` another place a line is drawn ({@link MARGIN}). */
export let kind = <B extends Beside = Beside>(
  match: string,
  draw: Kind<B>['draw'],
  view = LINE,
): Kind<B> => ({ view, match: match ? query(match) : true, draw })

/** The kinds of line any transcript has: a tool call, a thought, a refusal,
 * a reply, a failure, a stop, and a person's words, which is any entry no
 * other kind draws. */
export let kinds: Registry<Kind> = define<Kind>([
  kind('.call', tool),
  kind('.reasoning', thought),
  kind('.refusal&!result', refused),
  kind('.output&.notice', (_, beside) => interrupted(beside)),
  kind('.output&.exception', (_, beside) => failed(beside)),
  kind('.output', (b) => body(b) ? { node: reply(body(b)) } : undefined),
  kind('.failed', (_, beside) => failed(beside)),
  kind('.exception', (_, beside) => failed(beside)),
  kind('.stop', stopped),
  kind('.interrupted', stopped),
  kind('.cancel', stopped),
  kind(
    '',
    (b) => theirs(b) ? { node: yours(words(body(b))), is: 'theirs' } : null,
  ),
])
