import { Attachments, Notice, Pairs, Transcript } from '@yaks/ui/parts'
// How the Operator's chat draws a conversation's lines: the person's words,
// the replies, each tool call as a short line in plain words that opens on
// what it asked for and what came back, and what each model was told. Pure,
// and the one drawing of them: the Builder object draws a conversation with
// it for the page (operator-view.ts `talk`), and the page's socket sends each
// line a step changed as the entries it draws (`Lines`), which the chat page
// (operator-rows.ts) and the iOS shell (native/operator.tsx) draw with it
// again, each with its own host. It imports no server, so it bundles for a
// browser and for the shell alike.
import type { Bundle, Comp } from '@yaks/graph/bundle'
import { type Step, stepOf, type Steps } from '@yaks/tools/title'
import { blocks, Host, type Options, parse } from '@yaks/markdown'
import { type ComponentChildren as Node, Fragment, h } from 'preact'
import { useContext } from 'preact/hooks'
import { Body, Drop, Icon, Menu, More } from '@yaks/ui/parts'
import { type IconName, icons } from './icons.ts'
import { pretty } from '@yaks/ui/relative'
import { PART } from '@yaks/persona/part'
import { sourceWords } from './operator-source.ts'
import { measured, type Metadata } from './operator-metadata.ts'
import { contactCard } from './operator-contact-card.ts'

let comp = (b: Bundle | undefined, name: string) =>
  b?.[name] as Comp | undefined

/** A line before it is drawn: its parts, under the id it is put by, the
 * entries it draws when it draws more than its own (`of`), and every entry
 * it reads to draw them (`uses`), which is what the socket sends of it.
 * `text` replaces source content when the line displays different words. */
export type Line = {
  id: string
  node: Node
  text?: string
  of?: string[]
  uses: string[]
  /** a step, which flows beside the steps around it while closed, or the
   * person's own words, which sit on their side */
  is?: 'step' | 'theirs'
}
/** How a call reads to the person, by its tool's eid (`call.to`) and its
 * arguments: what it is doing while it runs and what it did once it answered
 * (@yaks/tools `stepOf`). */
export type Names = (tool: string, args?: Record<string, unknown>) => Step

let cut = (text: string, most: number) =>
  text.length > most ? text.slice(0, most) + '…' : text

let NOT_INPUT = [
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
  'ask',
  'prompt',
]

// What a person wrote. A task's first input is the task itself as JSON (its
// row, and on older sessions its comments): its body is what they wrote.
let words = (body: string) => {
  if (body.startsWith('{')) {
    try {
      let task = JSON.parse(body).task
      let doc = task?.doc ?? task
      if (typeof doc?.body == 'string') return doc.body
    } catch {
      // Not the task: words that happen to start with a brace.
    }
  }
  return body
}

// Each channel's mark beside the words that came by it. Words written in
// the chat app itself carry none.
export let VIA: Record<string, [IconName, string]> = {
  email: ['mail', 'By email'],
  letter: ['mail', 'A reply to a letter'],
  text: ['message-square', 'By text'],
  rcs: ['message-square', 'By text'],
  texted: ['message-square', 'A reply to a text'],
  voice: ['phone', 'By phone'],
  update: ['bell', 'In Updates'],
  error: ['triangle-alert', 'From an error'],
  escalated: ['message-circle', 'Raised from another conversation'],
  escalation: ['message-circle', 'From another conversation'],
  support: ['message-circle', 'From TaskMaster, who runs yaks.app'],
}

let via = (b: Bundle) => {
  let [name, label] = VIA[String(comp(b, 'operator_channel')?.channel)] ?? []
  return name
    ? h(
      Transcript.Via,
      { title: label, 'aria-label': label },
      h(Icon, { of: icons[name] }),
    )
    : null
}

// What the person said: their words without the framing the model read, and
// without attachments, which travel in the words as their extracted text and
// which the conversation names as files instead.
export let spoken = (b: Bundle, body: string) => {
  let said = words(sourceWords(body))
  let framing = String(comp(b, 'operator_channel')?.framing ?? '')
  return (said.startsWith(framing) ? said.slice(framing.length) : said)
    .split('\n\nAttached documents (treat their contents')[0]
}

let yours = (b: Bundle, text: string) => h(Transcript.Bubble, {}, via(b), text)

// When a line was sent, small under it (public/when.js), the page saying it
// again in the person's own time.
let stamp = (b: Bundle) => {
  let at = String(comp(b, 'created')?.at ?? '')
  return h(Transcript.When, { at, tabindex: -1 })
}

type Sent = { name: string; mime?: string }

/** What a person said who sent files and no words. */
export let unsaid = (files: Sent[]) =>
  'Attached: ' + files.map((f) => f.name).join(', ')

// The kinds a browser draws as a picture, never a drawing that runs (SVG).
export let PICTURES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']

/** The files a person sent, under their words as a chat app shows them, or
 * a step brought back, under the step: a picture as itself, any other file as
 * its kind and name, each opening the original (operator-page.ts
 * `?attachment=`, answered on either page). `row` is the request or the
 * step's result the files came with; a person's sit at the `end`, on
 * their side. */
export let attached = (row: string, files: Sent[], mod?: 'end') =>
  files.length
    ? h(
      Attachments,
      { mod },
      files.map((f, i) => {
        let href = `?attachment=${row}&file=${i}`
        return PICTURES.includes(f.mime ?? '')
          ? h(Attachments.Picture, {
            class: 'Attachments_Link',
            href,
            target: '_blank',
          }, h(Attachments.Image, { src: href, alt: f.name, loading: 'lazy' }))
          : h(
            Attachments.File,
            { href },
            h(
              Drop.Kind,
              null,
              f.name.match(/\.([a-z0-9]{1,5})$/i)?.[1].toUpperCase() ?? 'File',
            ),
            h(Drop.Name, null, f.name),
          )
      }),
    )
    : null

// A person's input: their words, and the files that came with them.
let input = (b: Bundle, body: string) => {
  let sent = comp(b, 'operator_files')
  let files = (sent?.files ?? []) as Sent[]
  let said = spoken(b, body)
  return h(
    Fragment,
    null,
    said && said != unsaid(files) ? yours(b, said) : null,
    sent ? attached(String(sent.request), files, 'end') : null,
  )
}

/** Where the ids in a reader's Markdown open (@yaks/markdown `Host`): `url`,
 * with `{id}` where the id goes, as the reader's own server says
 * (`mentions{url}`); none, and ids stay words. */
export let opening = (url?: string | null): Options =>
  url ? { refs: (id) => url.replaceAll('{id}', encodeURIComponent(id)) } : {}

// An id that opens on another site opens in a tab of its own, so the page
// it was read on stays.
let away =
  ((tag: string, props: Record<string, unknown> | null, ...kids: Node[]) =>
    h(
      tag,
      tag == 'a' && props?.['data-ref'] && /^https?:/.test(String(props.href))
        ? { ...props, target: '_blank', rel: 'noopener' }
        : props,
      ...kids,
    )) as typeof h

// The words, under the Refs of the page they are drawn on.
let Prose = ({ text }: { text: string }) =>
  h(Fragment, null, ...blocks(parse(text), away, useContext(Host)))

/** Markdown drawn as formatted text, the kit's Body: markup in it stays
 * words, and an id is a link where the page's `Host` opens it
 * (@yaks/markdown). */
export let markdown = (text: string) =>
  h(Body, { mod: 'flow' }, h(Prose, { text }))

/** A reply as the Operator wrote it, in Markdown. */
export let reply = (text: string) => h(Transcript.Reply, {}, markdown(text))

// A value a tool was given or gave back, the way a person reads it: a list
// of what it holds under names in words, never its JSON. Bounded in depth,
// length and count, since a tool can answer with a whole file.
let readable = (value: unknown, depth = 0): Node => {
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
let laid = (detail: unknown) => {
  if (typeof detail != 'string') return JSON.stringify(detail, null, 2)
  let [, head, rest] = detail.match(/^(\d{3} )?\s*([[{][\s\S]*)$/) ?? []
  if (rest == null) return detail
  try {
    return (head ?? '') + JSON.stringify(JSON.parse(rest), null, 2)
  } catch {
    return detail
  }
}

/** The one way the chat draws an error: what happened and what to do, in
 * words, with what the error said only inside a closed "Details". */
export let trouble = (said: string, detail?: unknown) =>
  h(
    Transcript.Error,
    {},
    h(Notice, { mod: 'negative' }, said),
    detail == null || detail === '' ||
      (typeof detail == 'object' && !Object.keys(detail).length)
      ? null
      : step('Details', '', h(Body.Source, { mod: 'detail' }, laid(detail))),
  )

// The one way the chat draws anything that opens: a step, by what it did,
// opening on what it holds; `on` while it runs, `no` once it did not work. A
// fold in a fold is the same fold.
let step = (name: Node, mod: '' | 'on' | 'no', ...inside: Node[]) =>
  h(
    More,
    { mod: ['quiet', mod] },
    h(More.Summary, {}, name),
    h(More.Body, {}, ...inside),
  )

// A step that did not work: "Tried texting Jeff".
let tried = (doing: string) =>
  'Tried ' + doing.replace(/…$/, '').replace(/^./, (c) => c.toLowerCase())

// A tool call and, once it came back, its answer: one row, under the call's
// id, so the answer takes the call's place on the page. The files it brought
// back (an image it made) are drawn under it, open.
let tool = (
  call: Bundle,
  names: Names,
  result?: Bundle,
  told: Node[] = [],
) => {
  let c = comp(call, 'call')!
  let said = names(String(c.to), c.args as Record<string, unknown>)
  let ok = result ? !comp(result, 'refusal') && !result.exception : null
  let files = (comp(result, 'operator_files')?.files ?? []) as Sent[]
  let name = ok == null ? said.doing : ok ? said.done : tried(said.doing)
  let problem = 'This step did not work, so the Operator went on without it.'
  let drawn = step(
    name,
    ok == null ? 'on' : ok ? '' : 'no',
    h(More.Label, {}, 'What it asked for'),
    readable(c.args ?? {}),
    ...told,
    ok == null ? null : ok
      ? [
        h(More.Label, {}, 'What came back'),
        readable(String(comp(result, 'content')?.body ?? '')),
      ]
      : trouble(
        problem,
        comp(result, 'content')?.body ?? result!.exception ??
          comp(result, 'refusal'),
      ),
  )
  return {
    node: files.length
      ? h(Fragment, null, drawn, attached(result!.entity.eid, files))
      : drawn,
    text: ok === false ? `${name}\n\n${problem}` : undefined,
    is: 'step' as const,
  }
}

// A helper session's end, told to the Operator (@yaks/session `deliverChild`):
// one of its steps, never the person's words. A receipt from before it said
// so (`delivery`) is known by the first line deliverChild gives it.
let LEGACY = /^child [0-9a-f-]{36} (settled|failed|stopped)\n/
export let told = (b: Bundle, body: string) =>
  !b.result && (b.delivery || LEGACY.test(body))
let helper = (b: Bundle, body: string) => {
  let outcome = comp(b, 'delivery')?.outcome ?? body.match(LEGACY)?.[1]
  let said = body.replace(/^.*\n/, '')
  let name = 'A helper could not finish'
  let problem =
    'A helper the Operator started could not finish, so the Operator went on without it.'
  return outcome == 'settled'
    ? {
      is: 'step' as const,
      node: step(
        'Heard back from a helper',
        '',
        h(More.Label, {}, 'What came back'),
        readable(said),
      ),
    }
    : {
      node: step(
        name,
        'no',
        trouble(problem, said),
      ),
      text: `${name}\n\n${problem}`,
      is: 'step' as const,
    }
}

// What a model was told before anything was said to it, closed until
// opened.
let instructed = (said: string, ...inside: Node[]) => step(said, '', ...inside)

// What a model was told is Markdown, drawn the way a reply is.
let written = markdown

// What a page has drawn of what its models were told: each layer and each
// tool, by its text. One drawn above is not drawn again: a conversation's
// asks and its helpers' are mostly told the same, and drawing each in full
// made Jeff's conversation 2.5 MB, 94% of it the same 90 tools (T-144992).
type Drawn = Set<string>
let fresh = (page: Drawn, text: string) => !page.has(text) && !!page.add(text)
let SAME = h('p', null, 'The same as above.')

// Each tool as the model was offered it: its name, opening on its
// description and the arguments it takes; those drawn above are counted.
let offered = (tools: Tool[], page: Drawn) => {
  let shown = tools.filter((t) => fresh(page, 'tool ' + JSON.stringify(t)))
  let rest = tools.length - shown.length
  return [
    ...shown.map((t) =>
      step(
        t.name,
        '',
        written(t.description),
        h(
          Body.Source,
          { mod: 'detail' },
          JSON.stringify(t.parameters, null, 2),
        ),
      )
    ),
    !rest
      ? null
      : shown.length
      ? h('p', null, `The other ${rest} are as above.`)
      : SAME,
  ]
}

// The tools an ask offered as a layer: one line each, in no order, so what
// changed is the tools put in, taken out or told differently.
let toolset = (tools: Tool[]): Layer => {
  let lines = tools.map((t) => JSON.stringify(t)).sort()
  return {
    name: `${tools.length} tools`,
    key: 'tools',
    text: lines.join('\n'),
    lines,
    inside: (page) => offered(tools, page),
  }
}

/** A tool as a model was offered it (@yaks/model `Tool`). */
export type Tool = {
  name: string
  description: string
  parameters: Record<string, unknown>
}

/** The tool offers asks name (`sending{offer}`), by their sha. */
export type Offers = Map<string, Tool[]>

/** A layer of what a model was told: its name, what it holds drawn on a page
 * (once its text is drawn above, that it is the same), what tells a later
 * ask's from it (`key`, and `text`, what a person reads of it: no spacing, no
 * order), and what it lost and gained since a layer before it (`lines`). */
type Layer = {
  name: string
  key: string
  inside: (page: Drawn) => Node | Node[]
  text: string
  lines: string[]
}

// What a person reads of some lines: each without its spacing, none blank.
let read = (text: string) =>
  text.split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean)

// A layer of Markdown, drawn once a page.
let prose = (name: string, text: string, key = name): Layer => ({
  name,
  key,
  text: read(text).join('\n'),
  lines: read(text),
  inside: (page) => fresh(page, key + '\n' + text) ? written(text) : SAME,
})

// What a layer lost and gained since the one before it: whole, when it is
// new; the lines gone and the lines come, when it changed.
let change = (now: Layer | undefined, before: Layer | undefined) => {
  let gone = (a?: Layer, b?: Layer) =>
    (a?.lines ?? []).filter((l) => !b?.lines.includes(l))
  let lines = (said: string, list: string[]) =>
    list.length
      ? [
        h(More.Label, {}, said),
        h(Body.Source, { mod: 'detail' }, list.join('\n')),
      ]
      : []
  return !before ? now!.inside(new Set()) : [
    ...lines('Taken out', gone(before, now)),
    ...lines('Put in', gone(now, before)),
  ]
}

// What a part a persona voiced is called: its heading, without the id before
// its title (@yaks/persona `voice`).
let heading = (part: string) =>
  part.match(/^#+ (?:(?:#\S+|[A-Z]+-\d+) )?(.*)\n?/)

// The layers of a system prompt: each document its persona wears, by its
// title, base first, and what its host added after them (@yaks/persona
// `PART`). A rule inside a document stays in it.
let voiced = (said: string): Layer[] =>
  said.split(PART).reduce(
    (parts: { name: string; text: string }[], part, i, all) => {
      let head = heading(part)
      let last = parts.at(-1)
      if (!head && last && i < all.length - 1) {
        last.text += PART + part
        return parts
      }
      return [...parts, {
        name: head?.[1].trim() ||
          (i ? 'Its spaces, apps and connections' : 'Its instructions'),
        text: head ? part.slice(head[0].length) : part,
      }]
    },
    [],
  ).map((l) => ({ ...l, text: l.text.trim() })).filter((l) => l.text)
    .map((l) => prose(l.name, l.text))

// What a prompt entry is, by where it came from (@yaks/session `spawn`).
let NOTES: Record<string, string> = {
  'harness:fork': 'That it is a fork of the conversation',
  'delegation:instructions': 'The guidance it was started with',
  'operator:earlier': 'What the person said before on this',
}

// The layers of an ask by key.
type Layers = Map<string, Layer>

// What changed between an ask's layers and the ask's before it: each layer
// new, changed or taken out, by what a person reads of it.
let changes = (now: Layers, was: Layers) =>
  [...new Set([...now.keys(), ...was.keys()])].flatMap((key) => {
    let [l, b] = [now.get(key), was.get(key)]
    let mark = !b ? 'new' : !l ? 'taken out' : l.text != b.text && 'changed'
    return mark ? [{ name: `${(l ?? b)!.name} (${mark})`, l, b }] : []
  })

// One entry holding a context's layers, each closed until opened; one at a
// later ask holds only what changed since the ask before (`was`), each with
// its change, drawn whole whatever the page drew above.
let context = (
  who: string,
  layers: Layer[],
  page: Drawn,
  was?: Layers,
) =>
  was
    ? instructed(
      `The context ${who} was given changed here`,
      changes(new Map(layers.map((l) => [l.key, l])), was).map((c) =>
        instructed(c.name, change(c.l, c.b))
      ),
    )
    : instructed(
      `The context ${who} was given`,
      layers.map((l) => instructed(l.name, l.inside(page))),
    )

/** What a transcript's model was told, from the record: at its first ask, one
 * entry holding each layer of its system prompt (`sending{instructions}`),
 * each prompt entry before it (a fork's note, a helper's guidance) and the
 * tools it was offered (`sending{offer}`); and again at a later ask whose
 * context differs from the ask before it. Each is drawn when its line is,
 * in the page's order, so what it says is above is. `sources` is given each
 * ask's own entries: the notes it carried, and itself. */
let briefed = (
  entries: Bundle[],
  who: string,
  offers: Offers = new Map(),
  page: Drawn = new Set(),
  sources = new Map<string, string[]>(),
): Told[] => {
  let last = new Map<string, Layers>()
  // The entries each session's last ask was told from: its notes and itself.
  let from = new Map<string, string[]>()
  let notes: (Layer & { id: string })[] = []
  let rows = entries.flatMap((b): Told[] => {
    let id = b.entity.eid
    if (b.prompt) {
      let text = String(comp(b, 'content')?.body ?? '')
      let name = NOTES[String(comp(b, 'prompt')?.source)] ??
        'A note it was given'
      if (text) notes.push({ id, ...prose(name, text) })
      return []
    }
    let sending = comp(b, 'sending')
    if (!b.ask || !sending) return []
    let session = String(comp(b, 'entry')?.session)
    let was = last.get(session)
    let said = typeof sending.instructions == 'string'
      ? sending.instructions
      : ''
    let offer = typeof sending.offer == 'string' ? sending.offer : ''
    let tools = offers.get(offer)
    let noted = notes.splice(0)
    let own = [...noted.map((n) => n.id), id]
    let uses = [...from.get(session) ?? [], ...own]
    from.set(session, own)
    sources.set(id, own)
    let layers: Layer[] = [
      ...voiced(said),
      ...noted,
      ...tools ? [toolset(tools)] : [],
    ]
    let now = new Map(layers.map((l) => [l.key, l]))
    last.set(session, now)
    return layers.length && (!was || changes(now, was).length)
      ? [{ id, uses, draw: () => context(who, layers, page, was) }]
      : []
  })
  // Notes no ask has sent yet.
  return notes.length
    ? [...rows, {
      id: notes[0].id,
      uses: notes.map((n) => n.id),
      draw: () => context(who, notes, page),
    }]
    : rows
}

// A line of what a model was told, drawn when the page reaches it, and the
// entries it was told from: the ask, the notes it carried, and the ask
// before it in its session, which says what changed since.
type Told = { id: string; uses: string[]; draw: () => Node }

/** A helper the Operator started: its session, the call that started it,
 * when one did, and its transcript. */
export type Helper = { session?: string; call?: string; entries: Bundle[] }

/** What a conversation draws beside its own transcript: the helpers it
 * started, the tool offers its asks name, what its Operator is called, and
 * where a conversation opens, by its id after `opens/`. */
export type Seen = {
  helpers?: Helper[]
  threads?: Record<string, Thread>
  metadata?: Record<string, Metadata>
  offers?: Offers
  called?: string
  opens?: string
  /** where an id in the words opens for their reader, `{id}` where it goes
   * (`opening`) */
  mentions?: string
} & Naming

/** What the calls' steps are said from: each tool a call points at
 * (`call.to`) by its eid, as its `tool` component names it, and whom the
 * calls work for. */
export type Naming = {
  tools?: Record<string, Named>
  person?: string | null
}

/** What a tool is called, of its `tool` component: its name, title and
 * steps (@yaks/tools `stepOf`). */
export type Named = { name?: string; title?: string; step?: Steps }

/** How the calls read, from what names them. */
export let namer = ({ tools = {}, person }: Naming): Names => (tool, args) =>
  stepOf(
    tools[tool] ?? { title: 'Use a tool' },
    args,
    person ? { person } : undefined,
  )

// What a helper was told, all its asks', in one place.
export let helped = (h: Helper, offers?: Offers, page?: Drawn) =>
  briefed(h.entries, 'the helper', offers, page)

/** A line in its row, under its id, as the conversation and every fold in it
 * put one. */
export let row = (line: { id: string; node: Node }) =>
  h(Transcript.Row, { id: `row-${line.id}` }, line.node)

// Lines inside a fold, spaced as the conversation's are.
let rows = (lines: { id: string; node: Node }[]) =>
  lines.length ? h(Transcript.Lines, { 'data-rows': '' }, lines.map(row)) : null

// The frame every line is drawn in, wherever it is drawn: what it says, then
// its time, which opens its menu. Copy, Quote and Copy link need only the
// line; Hide and Restore need the entries it draws, so a line of none (words
// no session has taken yet) goes without them.
let framed = (line: Line, entries: Bundle[]): Line => {
  let used = entries.filter((b) => line.uses.includes(b.entity.eid))
  let entered = used.filter((b) => b.entry)
  let first = entered[0] ?? used.find((b) => comp(b, 'created')?.at)
  let archived = entered.filter((b) => b.archived).map((b) => b.entity.eid)
  let ids = archived.length ? archived : [line.id]
  let text = line.text ??
    (entered.length ? entered : used).map((b) =>
      spoken(b, String(comp(b, 'content')?.body ?? ''))
    ).filter(Boolean).join('\n\n')
  let menu = 'entry-menu-' + line.id
  return {
    ...line,
    node: h(
      Transcript.Entry,
      { mod: [line.is, archived.length > 0 && 'hidden'] },
      line.node,
      h(
        Transcript.Meta,
        {},
        h(Menu.Trigger, {
          type: 'button',
          'data-menu-trigger': menu,
          'aria-controls': menu,
          'aria-haspopup': 'menu',
          'aria-expanded': 'false',
          'aria-label': 'Entry actions',
          'data-tip': pretty(String(comp(first, 'created')?.at ?? '')),
        }, first ? stamp(first) : 'Actions'),
        h(
          Menu,
          {
            id: menu,
            role: 'menu',
            hidden: true,
            mod: 'float',
            'aria-label': 'Entry actions',
            'data-entry-text': text,
          },
          h(Menu.Item, {
            type: 'button',
            role: 'menuitem',
            'data-entry-copy': '',
          }, 'Copy'),
          h(Menu.Item, {
            type: 'button',
            role: 'menuitem',
            'data-entry-quote': '',
            'data-entry-id': line.id,
          }, 'Quote'),
          h(Menu.Item, {
            type: 'button',
            role: 'menuitem',
            'data-entry-link': line.id,
          }, 'Copy link'),
          entered.length ? h(Menu.Rule, {}) : null,
          entered.length
            ? h(Menu.Item, {
              type: 'button',
              role: 'menuitem',
              'data-archive-entries': ids.join(','),
              'data-restore': String(archived.length > 0),
            }, archived.length ? 'Restore' : 'Hide')
            : null,
        ),
      ),
    ),
  }
}

export let lines = (
  entries: Bundle[],
  names: Names,
  {
    helpers = [],
    threads = {},
    offers,
    called = 'the Operator',
    opens,
    metadata,
  }: Seen = {},
): Line[] => {
  let results = new Map(
    entries.filter((b) => b.result).map((b) => [
      String(comp(b, 'result')!.call),
      b,
    ]),
  )
  let page: Drawn = new Set()
  let sources = new Map<string, string[]>()
  let prompts = new Map(
    briefed(entries, called, offers, page, sources).map((r) => [r.id, r]),
  )
  // A helper is told mostly what the ask before it was, which the page drew
  // above it: a line drawing what a helper was told reads that ask too, so
  // drawn alone it says the same is above where the page does.
  let before: string[] = []
  // What each helper a step started was told, under a link to its own
  // conversation.
  let under = (call: string) =>
    helpers.filter((one) => one.call == call).flatMap((one) => [
      opens && one.session
        ? h(
          'p',
          null,
          h(
            'a',
            { href: `${opens}/${one.session}` },
            'Open the helper’s conversation',
          ),
        )
        : null,
      rows(context(one)),
    ])
  // A helper's context, each line of it framed as the conversation's are.
  let context = (one: Helper) =>
    helped(one, offers, page).map((r) =>
      framed(
        { id: r.id, uses: r.uses, node: r.draw(), is: 'step' },
        one.entries,
      )
    )
  let calls = new Set(entries.map((b) => b.entity.eid))
  let inside = asked(entries)
  let folds = new Map<string, Fold>()
  let drawn: (Line | Fold)[] = []
  let byId = new Map(entries.map((b) => [b.entity.eid, b]))
  let said = (id: string) => !!comp(byId.get(id), 'operator_call')?.said
  let wrap = (line: Line, rows: Bundle[]) =>
    framed({ ...line, node: measured(line.node, metadata?.[line.id]) }, rows)
  for (let b of entries) {
    let id = b.entity.eid
    let body = String(comp(b, 'content')?.body ?? '')
    let told = prompts.get(id)
    let result = results.get(id)
    let helping = b.call && helpers.some((one) => one.call == id)
    let thread = threads[id]
    let unwrapped: Line[] = thread
      ? [{ id, uses: [id], ...threaded(thread) }]
      : told
      ? [{ id, uses: told.uses, node: told.draw(), is: 'step' as const }]
      : b.call
      ? [{
        id,
        uses: [
          ...helping ? before : [],
          id,
          ...result ? [result.entity.eid] : [],
        ],
        ...tool(b, names, result, under(id)),
      }]
      : line(b, id, body, opens)
    let these = unwrapped.map((l) => wrap(l, result ? [b, result] : [b]))
    before = sources.get(id) ?? before
    let at = inside.get(id)
    let fold = at && folds.get(at)
    if (fold) {
      fold.of.push(id)
      fold.uses.push(id, ...these.flatMap((l) => l.uses))
      fold.nodes.push(...these)
    } else if (at) {
      // The request opens under the caller's words before it, past what the
      // voice said since, which say it; with none, its own words stand for
      // them.
      let back = drawn.findLastIndex((l) => 'nodes' in l || !said(l.id))
      let last = drawn[back]
      let by = last && !('nodes' in last) && heard(byId.get(last.id)) ||
        { b, said: spoken(b, body) }
      fold = {
        ...by,
        of: [...new Set([by.b.entity.eid, id])],
        uses: [...new Set([by.b.entity.eid, id])],
        nodes: [],
      }
      folds.set(at, fold)
      if (by.b == b) drawn.push(fold)
      else drawn[back] = fold
    } else drawn.push(...these)
  }
  return [
    ...drawn.map((l) =>
      'nodes' in l
        ? wrap({
          id: l.of[0],
          of: l.of,
          uses: l.uses,
          node: h(Called, l),
          text: l.said,
          is: 'theirs',
        }, [l.b])
        : l
    ),
    // A helper no step of these started (one given a task) closes the list.
    ...helpers.filter((h) => !h.call || !calls.has(h.call))
      .flatMap((h) => context(h).map((l) => ({ ...l, uses: before }))),
  ]
}

// A person's own words: an input that is none of the other kinds.
export let theirs = (b: Bundle) =>
  !!comp(b, 'content')?.body && !NOT_INPUT.some((c) => b[c])

// What a call's talking model asked the Operator (`operator_call.asked`)
// through the Operator's written answer, by the request each entry belongs
// to: the exchange inside a turn of the call. The lines said aloud on it are
// not part of it, and the next words given end it, answered or not.
export let asked = (entries: Bundle[]) => {
  let inside = new Map<string, string>()
  let open: string | undefined
  for (let b of entries) {
    let id = b.entity.eid
    if (comp(b, 'operator_call')?.asked) {
      open = id
    } else if (!open || b.notice && b.operator_call) continue
    else if (theirs(b)) {
      open = undefined
      continue
    }
    inside.set(id, open)
    if (b.output && !b.notice && comp(b, 'content')?.body) open = undefined
  }
  return inside
}

// A turn of a call: the caller's words (`said`, of `b`), and folded under
// them the request their talking model made of them, the Operator's work
// and its written answer, `of` and `uses` the ids it is drawn from.
type Fold = {
  b: Bundle
  said: string
  of: string[]
  uses: string[]
  nodes: Line[]
}

// The caller's words on a call, as they were heard.
let heard = (b?: Bundle) => {
  let called = comp(b, 'operator_call')
  if (!b || !called || called.said || called.began || !b.notice) return
  let said = spoken(b, String(comp(b, 'content')?.body ?? ''))
  return said ? { b, said } : undefined
}

// The caller's words, whose phone mark opens what the Operator was asked of
// them and did, under them.
let Called = ({ said, nodes }: Fold) =>
  h(
    More,
    { as: 'div', mod: 'quiet' },
    h(
      Transcript.Bubble,
      {},
      h(
        Transcript.Via,
        {},
        h(More.Mark, {
          title: 'By phone: what the Operator did with it',
          'aria-label': 'By phone: what the Operator did with it',
        }, h(Icon, { of: icons.phone })),
      ),
      said,
    ),
    h(More.Body, {}, rows(nodes)),
  )

// Any other line: a refusal, a reply, a helper's end, a failure, a stop, or a
// person's words.
let line = (
  b: Bundle,
  id: string,
  body: string,
  opens?: string,
): Line[] => {
  let is = (node: Node, text?: string, kind?: Line['is']) => [
    { id, node, text, uses: [id], is: kind },
  ]
  if (b.operator_contact) {
    return is(
      b.verified
        ? h(Notice, {}, 'Your contact is confirmed.')
        : b.cancelled
        ? h(
          Notice,
          {},
          'This contact request is no longer active.',
        )
        : String(comp(b, 'operator_contact')?.address ?? '').includes('@')
        ? h(
          Notice,
          {},
          'Check your email for the contact verification code.',
        )
        : contactCard(body),
    )
  }
  // A provider's refusal (its own response kept beside it) is said in plain
  // words; its error waits in Details.
  if (b.refusal && !b.result && (b.response || !b.output)) {
    let said =
      'The Operator could not get an answer from its model, so it stopped before replying. Send your message again to try once more.'
    return is(
      trouble(
        said,
        body || comp(b, 'response')?.body || comp(b, 'refusal'),
      ),
      said,
    )
  }
  if (b.output && body) return is(reply(body))
  // A line of a call its talking model hears and speaks: theirs, or its own
  // (old rows, before its own were outputs). Where the call began is the
  // model's to read.
  let called = comp(b, 'operator_call')
  if (called?.began) return []
  if (called && b.notice && body) {
    return called.said
      ? is(reply(spoken(b, body)))
      : is(input(b, body), undefined, 'theirs')
  }
  // A helper the person stopped (operator.ts `stop`, the only stop here),
  // told to the session that started it in its report or, up the
  // conversation, in a line of theirs.
  let stopped = comp(b, 'operator_stopped')?.helper ??
    (comp(b, 'delivery')?.outcome == 'stopped'
      ? comp(b, 'delivery')?.child
      : undefined)
  if (stopped && !b.result) {
    let helper = opens
      ? h('a', { href: `${opens}/${stopped}` }, 'a helper')
      : 'a helper'
    return is(
      h(Notice, {}, 'You stopped ', helper, '.'),
    )
  }
  if (told(b, body)) return [{ id, uses: [id], ...helper(b, body) }]
  if (b.failed || b.exception) {
    let said =
      'Something went wrong, and the Operator stopped before it finished. Send your message again to try once more.'
    return is(
      trouble(
        said,
        body || b.exception || b.failed,
      ),
      said,
    )
  }
  if (b.system && body) return is(system(b, body), undefined, 'step')
  if (b.stop || b.interrupted || b.cancel) {
    return is(h(Notice, {}, 'Stopped.'))
  }
  if (theirs(b)) return is(input(b, body), undefined, 'theirs')
  return []
}

// Words the platform wrote into the conversation (`system`): a recovery, an
// error to fix. Never the person's: one quiet line, its words when opened.
let system = (b: Bundle, body: string) => {
  let [, label] = VIA[String(comp(b, 'operator_channel')?.channel)] ?? []
  return step(
    `${label ?? 'From the system'}: ${cut(spoken(b, body).split('\n')[0], 80)}`,
    '',
    written(spoken(b, body)),
  )
}

/** A closed outside conversation, drawn at its single delivery notice: who
 * chatted (`who`, "An outside agent for Ada") and the chat's own lines. */
export type Thread = { session: string; who: string; lines: Lines }

// A step like any other, named for whom the Operator chatted with, opening
// on the chat itself. The notice's body is the model's recap of the chat,
// never drawn: the chat's lines say it in the person's words.
let threaded = (thread: Thread) => {
  let name = 'Chatted with ' + thread.who.replace(/^./, (c) => c.toLowerCase())
  let node = step(
    name,
    '',
    thread.lines.opens
      ? h(
        'p',
        null,
        h(
          'a',
          { href: `${thread.lines.opens}/${thread.session}` },
          'Open the conversation',
        ),
      )
      : null,
    rows(drawLines(thread.lines)),
  )
  return { node, text: name, is: 'step' as const }
}

/**
 * Lines as a page's socket sends them: each line by the id it is put by and
 * the entries it reads (`uses`), those entries in the transcript's order,
 * and what they are drawn with beside them (the tools their calls name and
 * whom they work for, the helpers their calls started, the tool offers their
 * asks name, what the Operator is called and where a conversation opens).
 * {@link drawLines} draws each from these alone, as the conversation drew it.
 */
export type Lines = {
  threads?: Record<string, Thread>
  lines: { id: string; uses: string[] }[]
  entries: Bundle[]
  tools: Record<string, Named>
  person?: string | null
  helpers: Helper[]
  offers: Record<string, Tool[]>
  called?: string
  opens?: string
}

// The tool offer an ask names.
let offerOf = (b: Bundle) => {
  let offer = comp(b, 'sending')?.offer
  return typeof offer == 'string' ? offer : ''
}

/** These lines of `entries`, as {@link Lines}: only what they read. A
 * helper's lines are only what it was told (its asks and notes), all a
 * step it started draws of it. */
export let wire = (
  drawn: Line[],
  entries: Bundle[],
  seen: Seen = {},
): Lines => {
  let used = new Set(drawn.flatMap((l) => l.uses))
  let read = entries.filter((b) => used.has(b.entity.eid))
  let helpers = (seen.helpers ?? []).filter((h) =>
    h.call && used.has(h.call) ||
    drawn.some((l) => h.entries.some((b) => b.entity.eid == l.id))
  ).map((h) => ({ ...h, entries: h.entries.filter((b) => b.ask || b.prompt) }))
  let offers = new Set(
    [...read, ...helpers.flatMap((h) => h.entries)].map(offerOf),
  )
  let tools = new Set(read.map((b) => String(comp(b, 'call')?.to ?? '')))
  return {
    lines: drawn.map(({ id, uses }) => ({ id, uses })),
    entries: read,
    tools: Object.fromEntries(
      Object.entries(seen.tools ?? {}).filter(([eid]) => tools.has(eid)),
    ),
    ...seen.person ? { person: seen.person } : {},
    helpers,
    threads: Object.fromEntries(
      Object.entries(seen.threads ?? {}).filter(([id]) => used.has(id)),
    ),
    offers: Object.fromEntries(
      [...seen.offers ?? []].filter(([sha]) => offers.has(sha)),
    ),
    ...seen.called ? { called: seen.called } : {},
    ...seen.opens ? { opens: seen.opens } : {},
  }
}

/** Each line {@link Lines} sends, drawn from the entries it reads, as the
 * whole conversation draws it. */
export let drawLines = (sent: Lines): { id: string; node: Node }[] => {
  let seen = {
    ...sent,
    offers: new Map(Object.entries(sent.offers ?? {})),
  }
  let names = namer(sent)
  return sent.lines.flatMap(({ id, uses }) => {
    let reads = new Set(uses)
    let helpers = (sent.helpers ?? []).filter((h) =>
      h.call && reads.has(h.call) || h.entries.some((b) => b.entity.eid == id)
    )
    let entries = sent.entries.filter((b) => reads.has(b.entity.eid))
    let drawn = lines(entries, names, { ...seen, helpers })
      .find((l) => l.id == id)
    return drawn ? [{ id, node: drawn.node }] : []
  })
}

/** The native kit appearance of a conversation. */
export { transcriptLook as look } from '@yaks/ui/parts'
