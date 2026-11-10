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
import type { Colors } from '@yaks/ui'
import type { Style } from '@yaks/native'
import { type Step, stepOf, type Steps } from '@yaks/tools/title'
import { blocks, parse } from '@yaks/markdown/structural'
import { type ComponentChildren as Node, Fragment, h } from 'preact'
import { Body, Drop, Icon, Menu } from '@yaks/ui/parts'
import { type IconName, icons } from './icons.ts'
import { Time } from '@yaks/ui/parts'
import { pretty } from '@yaks/ui/relative'
import { PART } from '@yaks/persona/part'
import { sourceWords } from './operator-source.ts'
import { measured, type Metadata } from './operator-metadata.ts'

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
}

let via = (b: Bundle) => {
  let [name, label] = VIA[String(comp(b, 'operator_channel')?.channel)] ?? []
  return name
    ? h(
      'span',
      { class: 'Talk_Via', title: label, 'aria-label': label },
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

let yours = (b: Bundle, text: string) =>
  h('p', { class: 'Talk_You' }, via(b), text)

// When a line was sent, small under it (public/when.js), the page saying it
// again in the person's own time.
let stamp = (b: Bundle) => {
  let at = String(comp(b, 'created')?.at ?? '')
  return h(Time, { at, class: 'Talk_When', tabindex: -1 })
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
 * step's result the files came with. */
export let attached = (row: string, files: Sent[]) =>
  files.length
    ? h(
      'div',
      { class: 'Talk_Files' },
      files.map((f, i) => {
        let href = `?attachment=${row}&file=${i}`
        return PICTURES.includes(f.mime ?? '')
          ? h(
            'a',
            { class: 'Talk_Picture Talk_FilesLink', href, target: '_blank' },
            h('img', {
              class: 'Talk_Image',
              src: href,
              alt: f.name,
              loading: 'lazy',
            }),
          )
          : h(
            'a',
            { class: 'Talk_File Talk_FilesLink', href },
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
    sent ? attached(String(sent.request), files) : null,
  )
}

/** Markdown drawn as formatted text, the kit's Body: markup in it stays
 * words (@yaks/markdown). */
export let markdown = (text: string) => h(Body, null, ...blocks(parse(text), h))

/** A reply as the Operator wrote it, in Markdown. */
export let reply = (text: string) =>
  h('div', { class: 'Talk_Reply' }, markdown(text))

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
    return h('span', { class: 'Talk_DetailValue' }, 'Nothing')
  }
  if (typeof value != 'object') {
    return h('span', { class: 'Talk_DetailValue' }, cut(String(value), 600))
  }
  if (depth > 2) return h('span', { class: 'Talk_DetailValue' }, '…')
  let list = Array.isArray(value)
    ? value.map((v, i) => [String(i + 1), v] as const)
    : Object.entries(value)
  if (!list.length) return h('span', { class: 'Talk_DetailValue' }, 'Nothing')
  let more = list.length - 12
  return h(
    'dl',
    { class: 'Talk_Facts' },
    list.slice(0, 12).map(([k, v]) =>
      h(
        'div',
        { class: 'Talk_Fact' },
        h(
          'dt',
          { class: 'Talk_FactLabel' },
          Array.isArray(value)
            ? k
            : k.replace(/[_-]+/g, ' ').replace(/^./, (c) => c.toUpperCase()),
        ),
        h('dd', { class: 'Talk_FactValue' }, readable(v, depth + 1)),
      )
    ),
    more > 0
      ? h(
        'div',
        { class: 'Talk_Fact' },
        h('dd', { class: 'Talk_FactValue' }, `and ${more} more`),
      )
      : null,
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
    'div',
    { class: 'Talk_Trouble' },
    h('p', { class: 'Talk_Note Talk_Note-no' }, said),
    detail == null || detail === '' ||
      (typeof detail == 'object' && !Object.keys(detail).length)
      ? null
      : h(
        'details',
        null,
        h('summary', { class: 'Talk_TroubleSummary' }, 'Details'),
        h('pre', { class: 'Talk_TroubleDetail' }, laid(detail)),
      ),
  )

// A step, by what it did, opening on what it holds: `on` while it runs,
// `no` once it did not work.
let step = (name: string, mod: '' | 'on' | 'no', ...inside: Node[]) =>
  h(
    'details',
    { class: mod ? `Talk_Step Talk_Step-${mod}` : 'Talk_Step' },
    h('summary', { class: 'Talk_Summary' }, name),
    h('div', { class: 'Talk_Detail' }, ...inside),
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
    h('p', { class: 'Talk_DetailLabel' }, 'What it asked for'),
    readable(c.args ?? {}),
    ...told,
    ok == null ? null : ok
      ? [
        h('p', { class: 'Talk_DetailLabel' }, 'What came back'),
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
      node: step(
        'Heard back from a helper',
        '',
        h('p', { class: 'Talk_DetailLabel' }, 'What came back'),
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
    }
}

// What a model was told before anything was said to it, closed until
// opened, and drawn apart from the words, the replies and the errors.
let instructed = (said: string, ...inside: Node[]) =>
  h(
    'details',
    { class: 'Talk_Told' },
    h('summary', { class: 'Talk_ToldSummary' }, said),
    ...inside,
  )

// What a model was told is Markdown, drawn the way a reply is.
let written = (body: string) =>
  h('div', { class: 'Talk_Written' }, markdown(body))

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
      h(
        'details',
        null,
        h('summary', null, t.name),
        written(t.description),
        h(
          'pre',
          { class: 'Talk_ToldSource' },
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

/** A tool as a model was offered it (@yaks/model `Tool`). */
export type Tool = {
  name: string
  description: string
  parameters: Record<string, unknown>
}

/** The tool offers asks name (`sending{offer}`), by their sha. */
export type Offers = Map<string, Tool[]>

/** A layer of what a model was told: its name, what it holds drawn on a page
 * (once its text is drawn above, that it is the same), and what tells a later
 * ask's from it (`key`, its text). */
type Layer = {
  name: string
  key: string
  inside: (page: Drawn) => Node | Node[]
  text: string
}

// A layer of Markdown, drawn once a page.
let prose = (key: string, text: string) => (page: Drawn) =>
  fresh(page, key + '\n' + text) ? written(text) : SAME

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
    .map((l) => ({ ...l, key: l.name, inside: prose(l.name, l.text) }))

// What a prompt entry is, by where it came from (@yaks/session `spawn`).
let NOTES: Record<string, string> = {
  'harness:fork': 'That it is a fork of the conversation',
  'delegation:instructions': 'The guidance it was started with',
}

// One entry holding a context's layers, each closed until opened; one that
// changed at a later ask marks what changed since the ask before (`was`).
let context = (
  who: string,
  layers: Layer[],
  page: Drawn,
  was?: Map<string, string>,
) =>
  instructed(
    was
      ? `The context ${who} was given changed here`
      : `The context ${who} was given`,
    layers.map((l) =>
      instructed(
        l.name + (!was
          ? ''
          : !was.has(l.key)
          ? ' (new)'
          : was.get(l.key) != l.text
          ? ' (changed)'
          : ''),
        l.inside(page),
      )
    ),
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
  let last = new Map<string, Map<string, string>>()
  // The entries each session's last ask was told from: its notes and itself.
  let from = new Map<string, string[]>()
  let notes: (Layer & { id: string })[] = []
  let rows = entries.flatMap((b): Told[] => {
    let id = b.entity.eid
    if (b.prompt) {
      let text = String(comp(b, 'content')?.body ?? '')
      let name = NOTES[String(comp(b, 'prompt')?.source)] ??
        'A note it was given'
      if (text) {
        notes.push({ id, name, key: name, inside: prose(name, text), text })
      }
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
      ...tools
        ? [{
          name: `${tools.length} tools`,
          key: 'tools',
          inside: (page: Drawn) => offered(tools, page),
          text: offer,
        }]
        : [],
    ]
    let now = new Map(layers.map((l) => [l.key, l.text]))
    last.set(session, now)
    let same = was?.size == now.size &&
      [...now].every(([key, text]) => was!.get(key) == text)
    return layers.length && !same
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
  metadata?: Record<string, Metadata>
  offers?: Offers
  called?: string
  opens?: string
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

/** Every line of a transcript worth showing, in order, what each helper was
 * told inside the step that started it. */
let archivable = (line: Line, entries: Bundle[]): Line => {
  let rows = entries.filter((b) => line.uses.includes(b.entity.eid) && b.entry)
  if (!rows.length) return line
  let archived = rows.filter((b) => b.archived).map((b) => b.entity.eid)
  let ids = archived.length ? archived : [line.id]
  let text = line.text ??
    rows.map((b) => spoken(b, String(comp(b, 'content')?.body ?? '')))
      .filter(Boolean).join('\n\n')
  let menu = 'entry-menu-' + line.id
  return {
    ...line,
    node: h(
      'div',
      {
        class: archived.length ? 'Talk_Entry Talk_Entry-hidden' : 'Talk_Entry',
      },
      line.node,
      h(
        'div',
        { class: 'Talk_Meta' },
        h(Menu.Trigger, {
          type: 'button',
          'data-menu-trigger': menu,
          'aria-controls': menu,
          'aria-haspopup': 'menu',
          'aria-expanded': 'false',
          'aria-label': 'Entry actions',
          'data-tip': pretty(String(comp(rows[0], 'created')?.at ?? '')),
        }, stamp(rows[0])),
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
          h(Menu.Rule, {}),
          h(Menu.Item, {
            type: 'button',
            role: 'menuitem',
            'data-archive-entries': ids.join(','),
            'data-restore': String(archived.length > 0),
          }, archived.length ? 'Restore' : 'Hide'),
        ),
      ),
    ),
  }
}

export let lines = (
  entries: Bundle[],
  names: Names,
  { helpers = [], offers, called = 'the Operator', opens, metadata }: Seen = {},
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
      ...helped(one, offers, page).map((r) => r.draw()),
    ])
  let calls = new Set(entries.map((b) => b.entity.eid))
  let inside = asked(entries)
  let folds = new Map<
    string,
    { of: string[]; uses: string[]; nodes: Node[] }
  >()
  return [
    ...entries.flatMap((b): Line[] => {
      let id = b.entity.eid
      let body = String(comp(b, 'content')?.body ?? '')
      let told = prompts.get(id)
      let result = results.get(id)
      let helping = b.call && helpers.some((one) => one.call == id)
      let drawn: Line[] = told
        ? [{ id, uses: told.uses, node: told.draw() }]
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
      drawn = drawn.map((line) => {
        let row = archivable(line, result ? [b, result] : [b])
        return { ...row, node: measured(row.node, metadata?.[id]) }
      })
      before = sources.get(id) ?? before
      let at = inside.get(id)
      if (!at) return drawn
      let fold = folds.get(at)
      let uses = drawn.flatMap((l) => l.uses)
      if (fold) {
        fold.of.push(id)
        fold.uses.push(id, ...uses)
        fold.nodes.push(...drawn.map((l) => l.node))
        return []
      }
      fold = { of: [id], uses: [id, ...uses], nodes: drawn.map((l) => l.node) }
      folds.set(at, fold)
      return [{ id, of: fold.of, uses: fold.uses, node: h(Asked, fold) }]
    }),
    // A helper no step of these started (one given a task) closes the list.
    ...helpers.filter((h) => !h.call || !calls.has(h.call))
      .flatMap((h) => helped(h, offers, page))
      .map((r) => ({ id: r.id, uses: before, node: r.draw() })),
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

// The exchange folded behind a small mark between what the caller said and
// what they heard: their request and the Operator's work and answer.
let Asked = ({ nodes }: { nodes: Node[] }) =>
  h(
    'details',
    { class: 'Talk_Asked' },
    h(
      'summary',
      {
        class: 'Talk_AskedSummary',
        title: 'What was asked of the Operator',
        'aria-label': 'What was asked of the Operator',
      },
      h(Icon, { of: icons['message-circle'] }),
    ),
    h('div', { class: 'Talk_Inner' }, ...nodes),
  )

// Any other line: a refusal, a reply, a helper's end, a failure, a stop, or a
// person's words.
let line = (
  b: Bundle,
  id: string,
  body: string,
  opens?: string,
): Line[] => {
  let is = (node: Node, text?: string) => [{ id, node, text, uses: [id] }]
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
    return is(called.said ? reply(spoken(b, body)) : input(b, body))
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
      h('p', { class: 'Talk_Note' }, 'You stopped ', helper, '.'),
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
  if (b.system && body) return is(system(b, body))
  if (b.stop || b.interrupted || b.cancel) {
    return is(h('p', { class: 'Talk_Note' }, 'Stopped.'))
  }
  if (theirs(b)) return is(input(b, body))
  return []
}

// Words the platform wrote into the conversation (`system`): a recovery, an
// error to fix. Never the person's: one quiet line, its words when opened.
let system = (b: Bundle, body: string) => {
  let [, label] = VIA[String(comp(b, 'operator_channel')?.channel)] ?? []
  return h(
    'details',
    { class: 'Talk_Told Talk_System' },
    h(
      'summary',
      { class: 'Talk_ToldSummary' },
      `${label ?? 'From the system'}: `,
      cut(spoken(b, body).split('\n')[0], 80),
    ),
    written(spoken(b, body)),
  )
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

/** The native look of these lines' parts (@yaks/native `Look` classes), over
 * a theme's colours, as pages.css draws them on the web: the person's words
 * on the right in their own colour, the replies on the left, and every step
 * one quiet line until pressed. */
export let look = (c: Colors): Record<string, Style> => ({
  Talk_Said: { gap: 14, padding: 16 },
  Talk_You: {
    alignSelf: 'flex-end',
    maxWidth: '85%',
    backgroundColor: c.surface,
    borderRadius: 18,
    paddingVertical: 8,
    paddingHorizontal: 14,
    fontSize: 16,
    color: c.text,
  },
  Talk_Via: { color: c.dim },
  Talk_Entry: { gap: 4 },
  'Talk_Entry-hidden': { opacity: 0.5 },
  Talk_Meta: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  Talk_When: { fontSize: 12, color: c.dim },
  Talk_Reply: { gap: 8, fontSize: 16, color: c.text },
  Body: { gap: 8 },
  Talk_Step: { gap: 6 },
  'Talk_Step-on': { opacity: 0.8 },
  'Talk_Step-no': { opacity: 0.9 },
  Talk_Detail: {
    gap: 6,
    paddingLeft: 10,
    borderLeftWidth: 2,
    borderLeftColor: c.border,
  },
  Talk_Facts: { gap: 4 },
  Talk_Told: { gap: 6 },
  Talk_Written: { gap: 6 },
  Talk_Inner: { gap: 8, paddingLeft: 10 },
  Talk_Note: { fontSize: 15, color: c.muted },
  'Talk_Note-no': { color: c.negative },
  Talk_Trouble: { gap: 6 },
  Talk_Files: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  Talk_File: { color: c.link },
  Talk_Now: { fontSize: 15, color: c.muted, paddingHorizontal: 16 },
})
