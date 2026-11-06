// What the Operator's chat app shows of its work (operator-page.ts
// `chatPage`): each task as one conversation, its sessions drawn the way a
// chat app draws one (the person's words, the replies, and each tool call as
// a short line in plain words that opens on what it asked for and what came
// back) under a line for what it is doing now, and the list of conversations
// beside it. Pure: the page draws the conversation, and the Builder object
// sends the rows a step changed to the page's socket (`frame`), which puts
// each in place by its id.
import type { Bundle, Comp } from '@yaks/graph'
import type { Tool } from '@yaks/model'
import { statusOf } from '@yaks/session'
import type { Step } from '@yaks/tools/title'
import { toolEid } from '@yaks/tools/result'
import { blocks, parse } from '@yaks/markdown/structural'
import { PART } from '@yaks/persona'
import { type ComponentChildren as Node, Fragment, h } from 'preact'
import { renderToString } from 'preact-render-to-string'
import { Body, Button, Card, Drop, Icon, Loading, Rows } from '@yaks/ui/parts'
import { day, moment } from './html.ts'
import { chatPath } from './route.ts'
import { poseOf, Yak } from './mascot.ts'
import { type IconName, icons } from './icons.ts'
import { when } from './public/when.js'

let comp = (b: Bundle | undefined, name: string) =>
  b?.[name] as Comp | undefined

/** A drawn line of a transcript: what it shows, under the id it is put by. */
export type Row = { id: string; html: string }
// A line before it is drawn: its parts, under the id it is put by.
type Line = { id: string; node: Node }
let drawn = ({ id, node }: Line): Row => ({
  id,
  html: renderToString(h(Fragment, null, node)),
})
/** How a call reads to the person, by its tool's eid (`call.to`) and its
 * arguments: what it is doing while it runs and what it did once it answered
 * (@yaks/tools `stepOf`). */
export type Names = (tool: string, args?: Record<string, unknown>) => Step

let cut = (text: string, most: number) =>
  text.length > most ? text.slice(0, most) + '…' : text

let NOT_INPUT = [
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

/** How words sent with an app open beside the chat (operator-page.ts
 * `chatPage`) reach the Operator: after the app they are about, which the
 * person's own words on the page leave out. */
export let about = (app: string) =>
  `About the app ${app}, open beside the chat as they wrote: `

/** How a line said on a call its talking model answered itself reaches the
 * Operator (operator.ts `note`): the caller's words, or (`SAID`) the talking
 * model's, which the conversation draws as the Operator's own. */
export let HEARD = 'By phone: '
export let SAID = 'On the phone, you said: '

/** How words came (`operator_channel`): their channel, and the framing the
 * model reads before them, which the conversation leaves out. */
export let channelOf = (channel: string, framing = '') => ({
  channel,
  ...framing ? { framing } : {},
})

// Each channel's mark beside the words that came by it. Words written in
// the chat app itself carry none.
let VIA: Record<string, [IconName, string]> = {
  email: ['mail', 'By email'],
  letter: ['mail', 'A reply to a letter'],
  text: ['message-square', 'By text'],
  rcs: ['message-square', 'By text'],
  texted: ['message-square', 'A reply to a text'],
  voice: ['phone', 'By phone'],
  update: ['bell', 'In Updates'],
  error: ['triangle-alert', 'From an error'],
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
let spoken = (b: Bundle, body: string) => {
  let said = words(body)
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
  let said = when(at)
  return said ? h('time', { class: 'Talk_When', datetime: at }, said) : null
}

type Sent = { name: string; mime?: string }

/** What a person said who sent files and no words. */
export let unsaid = (files: Sent[]) =>
  'Attached: ' + files.map((f) => f.name).join(', ')

// The kinds a browser draws as a picture, never a drawing that runs (SVG).
export let PICTURES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']

/** The files a person sent, under their words as a chat app shows them: a
 * picture as itself, any other file as its kind and name, each opening the
 * original (operator-page.ts `?attachment=`, answered on either page). */
export let attached = (request: string, files: Sent[]) =>
  files.length
    ? h(
      'div',
      { class: 'Talk_Files' },
      files.map((f, i) => {
        let href = `?attachment=${request}&file=${i}`
        return PICTURES.includes(f.mime ?? '')
          ? h(
            'a',
            { class: 'Talk_Picture', href, target: '_blank' },
            h('img', { src: href, alt: f.name, loading: 'lazy' }),
          )
          : h(
            'a',
            { class: 'Talk_File', href },
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
  if (value == null || value === '') return h('span', null, 'Nothing')
  if (typeof value != 'object') {
    return h('span', null, cut(String(value), 600))
  }
  if (depth > 2) return h('span', null, '…')
  let list = Array.isArray(value)
    ? value.map((v, i) => [String(i + 1), v] as const)
    : Object.entries(value)
  if (!list.length) return h('span', null, 'Nothing')
  let more = list.length - 12
  return h(
    'dl',
    { class: 'Talk_Facts' },
    list.slice(0, 12).map(([k, v]) =>
      h(
        'div',
        null,
        h(
          'dt',
          null,
          Array.isArray(value)
            ? k
            : k.replace(/[_-]+/g, ' ').replace(/^./, (c) => c.toUpperCase()),
        ),
        h('dd', null, readable(v, depth + 1)),
      )
    ),
    more > 0 ? h('div', null, h('dd', null, `and ${more} more`)) : null,
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
        h('summary', null, 'Details'),
        h('pre', null, laid(detail)),
      ),
  )

// A step, by what it did, opening on what it holds: `on` while it runs,
// `no` once it did not work.
let step = (name: string, mod: '' | 'on' | 'no', ...inside: Node[]) =>
  h(
    'details',
    { class: mod ? `Talk_Step Talk_Step-${mod}` : 'Talk_Step' },
    h('summary', null, name),
    h('div', { class: 'Talk_Detail' }, ...inside),
  )

// A step that did not work: "Tried texting Jeff".
let tried = (doing: string) =>
  'Tried ' + doing.replace(/…$/, '').replace(/^./, (c) => c.toLowerCase())

// A tool call and, once it came back, its answer: one row, under the call's
// id, so the answer takes the call's place on the page.
let tool = (
  call: Bundle,
  names: Names,
  result?: Bundle,
  told: Node[] = [],
) => {
  let c = comp(call, 'call')!
  let said = names(String(c.to), c.args as Record<string, unknown>)
  let ok = result ? !comp(result, 'refusal') && !result.exception : null
  return step(
    ok == null ? said.doing : ok ? said.done : tried(said.doing),
    ok == null ? 'on' : ok ? '' : 'no',
    h('p', null, 'What it asked for'),
    readable(c.args ?? {}),
    ...told,
    ok == null ? null : ok
      ? [
        h('p', null, 'What came back'),
        readable(String(comp(result, 'content')?.body ?? '')),
      ]
      : trouble(
        'This step did not work, so the Operator went on without it.',
        comp(result, 'content')?.body ?? result!.exception ??
          comp(result, 'refusal'),
      ),
  )
}

// A helper session's end, told to the Operator (@yaks/session `deliverChild`):
// one of its steps, never the person's words. A receipt from before it said
// so (`delivery`) is known by the first line deliverChild gives it.
let LEGACY = /^child [0-9a-f-]{36} (settled|failed|stopped)\n/
let told = (b: Bundle, body: string) =>
  !b.result && (b.delivery || LEGACY.test(body))
let helper = (b: Bundle, body: string) => {
  let outcome = comp(b, 'delivery')?.outcome ?? body.match(LEGACY)?.[1]
  let said = body.replace(/^.*\n/, '')
  return outcome == 'settled'
    ? step(
      'Heard back from a helper',
      '',
      h('p', null, 'What came back'),
      readable(said),
    )
    : step(
      'A helper could not finish',
      'no',
      trouble(
        'A helper the Operator started could not finish, so the Operator went on without it.',
        said,
      ),
    )
}

// What a model was told before anything was said to it, closed until
// opened, and drawn apart from the words, the replies and the errors.
let instructed = (said: string, ...inside: Node[]) =>
  h('details', { class: 'Talk_Told' }, h('summary', null, said), ...inside)

// What a model was told is Markdown, drawn the way a reply is.
let written = (body: string) =>
  h('div', { class: 'Talk_Written' }, markdown(body))

// Each tool as the model was offered it: its name, opening on its
// description and the arguments it takes.
let offered = (tools: Tool[]) =>
  tools.map((t) =>
    h(
      'details',
      null,
      h('summary', null, t.name),
      written(t.description),
      h('pre', null, JSON.stringify(t.parameters, null, 2)),
    )
  )

/** The tool offers asks name (`sending{offer}`), by their sha. */
export type Offers = Map<string, Tool[]>

/** A layer of what a model was told: its name, what it holds drawn, and what
 * tells a later ask's from it (`key`, its text). */
type Layer = {
  name: string
  key: string
  inside: Node | Node[]
  text: string
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
    .map((l) => ({ ...l, key: l.name, inside: written(l.text) }))

// What a prompt entry is, by where it came from (@yaks/session `spawn`).
let NOTES: Record<string, string> = {
  'harness:fork': 'That it is a fork of the conversation',
  'delegation:instructions': 'The guidance it was started with',
}

// One entry holding a context's layers, each closed until opened; one that
// changed at a later ask marks what changed since the ask before (`was`).
let context = (who: string, layers: Layer[], was?: Map<string, string>) =>
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
        l.inside,
      )
    ),
  )

/** What a transcript's model was told, from the record: at its first ask, one
 * entry holding each layer of its system prompt (`sending{instructions}`),
 * each prompt entry before it (a fork's note, a helper's guidance) and the
 * tools it was offered (`sending{offer}`); and again at a later ask whose
 * context differs from the ask before it. */
let briefed = (
  entries: Bundle[],
  who: string,
  offers: Offers = new Map(),
): Line[] => {
  let last = new Map<string, Map<string, string>>()
  let notes: (Layer & { id: string })[] = []
  let rows = entries.flatMap((b): Line[] => {
    let id = b.entity.eid
    if (b.prompt) {
      let text = String(comp(b, 'content')?.body ?? '')
      let name = NOTES[String(comp(b, 'prompt')?.source)] ??
        'A note it was given'
      if (text) notes.push({ id, name, key: name, inside: written(text), text })
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
    let layers: Layer[] = [
      ...voiced(said),
      ...notes.splice(0),
      ...tools
        ? [{
          name: `${tools.length} tools`,
          key: 'tools',
          inside: offered(tools),
          text: offer,
        }]
        : [],
    ]
    let now = new Map(layers.map((l) => [l.key, l.text]))
    last.set(session, now)
    let same = was?.size == now.size &&
      [...now].every(([key, text]) => was!.get(key) == text)
    return layers.length && !same
      ? [{ id, node: context(who, layers, was) }]
      : []
  })
  // Notes no ask has sent yet.
  return notes.length
    ? [...rows, { id: notes[0].id, node: context(who, notes) }]
    : rows
}

/** A helper the Operator started: its session, the call that started it,
 * when one did, and its transcript. */
export type Helper = { session?: string; call?: string; entries: Bundle[] }

/** What a conversation draws beside its own transcript: the helpers it
 * started, the tool offers its asks name, what its Operator is called, and
 * where a conversation opens, by its id after `opens/`. */
export type Seen = {
  helpers?: Helper[]
  offers?: Offers
  called?: string
  opens?: string
}

// What a helper was told, all its asks', in one place.
let helped = (h: Helper, offers?: Offers) =>
  briefed(h.entries, 'the helper', offers)

/** Every line of a transcript worth showing, in order, what each helper was
 * told inside the step that started it. */
export let rows = (entries: Bundle[], names: Names, seen: Seen = {}): Row[] =>
  lines(entries, names, seen).map(drawn)

let lines = (
  entries: Bundle[],
  names: Names,
  { helpers = [], offers, called = 'the Operator', opens }: Seen = {},
): Line[] => {
  let results = new Map(
    entries.filter((b) => b.result).map((b) => [
      String(comp(b, 'result')!.call),
      b,
    ]),
  )
  let prompts = new Map(
    briefed(entries, called, offers).map((r) => [r.id, r]),
  )
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
      ...helped(one, offers).map((r) => r.node),
    ])
  let calls = new Set(entries.map((b) => b.entity.eid))
  return [
    ...entries.flatMap((b): Line[] => {
      let id = b.entity.eid
      let body = String(comp(b, 'content')?.body ?? '')
      if (prompts.has(id)) return [prompts.get(id)!]
      if (b.call) {
        return [{ id, node: tool(b, names, results.get(id), under(id)) }]
      }
      return line(b, id, body)
    }),
    // A helper no step of these started (one given a task) closes the list.
    ...helpers.filter((h) => !h.call || !calls.has(h.call))
      .flatMap((h) => helped(h, offers)),
  ]
}

// Any other line: a refusal, a reply, a helper's end, a failure, a stop, or a
// person's words.
let line = (b: Bundle, id: string, body: string): Line[] => {
  let is = (node: Node) => [{ id, node }]
  // A provider's refusal (its own response kept beside it) is said in plain
  // words; its error waits in Details.
  if (b.refusal && !b.result && (b.response || !b.output)) {
    return is(trouble(
      'The Operator could not get an answer from its model, so it stopped before replying. Send your message again to try once more.',
      body || comp(b, 'response')?.body || comp(b, 'refusal'),
    ))
  }
  if (b.output && body) return is(said(b, reply(body)))
  // A line of a call its talking model answered itself: theirs, or its own.
  let called = comp(b, 'operator_call')
  if (called && body) {
    return is(said(b, called.said ? reply(spoken(b, body)) : input(b, body)))
  }
  if (told(b, body)) return is(helper(b, body))
  if (b.failed || b.exception) {
    return is(trouble(
      'Something went wrong, and the Operator stopped before it finished. Send your message again to try once more.',
      body || b.exception || b.failed,
    ))
  }
  if (b.stop || b.interrupted || b.cancel) {
    return is(h('p', { class: 'Talk_Note' }, 'Stopped.'))
  }
  if (body && !NOT_INPUT.some((c) => b[c])) return is(said(b, input(b, body)))
  return []
}

// Words someone sent, and under them when.
let said = (b: Bundle, words: Node) => h(Fragment, null, words, stamp(b))

/** The line a step changed: a new line, or the call a new answer belongs to. */
export let touched = (
  entries: Bundle[],
  names: Names,
  from: number,
  seen: Seen = {},
): Row[] => {
  let ids = new Set(
    entries.filter((b) => Number(comp(b, 'entry')?.seq ?? 0) > from)
      .map((b) => b.result ? String(comp(b, 'result')!.call) : b.entity.eid),
  )
  return rows(entries, names, seen).filter((r) => ids.has(r.id))
}

/** What the session is doing now, in a line; nothing once it ended, however
 * it ended: its lines say how. */
export let now = (entries: Bundle[], names: Names) => {
  let status = statusOf(entries)
  if (status != 'pending' && status != 'running') return ''
  let answered = new Set(
    entries.filter((b) => b.result).map((b) => String(comp(b, 'result')!.call)),
  )
  let open = entries.filter((b) => b.call && !answered.has(b.entity.eid))
  return open.length
    ? open.map((b) => {
      let c = comp(b, 'call')!
      return names(String(c.to), c.args as Record<string, unknown>).doing
    }).join(' ')
    : 'Thinking…'
}

// What it is doing now, in words and as the yak's pose.
let doingNow = (entries: Bundle[], names: Names) => {
  let words = now(entries, names)
  return { now: words, pose: poseOf(words) }
}

/** An app a step put out a new version of: the space its call named ('' for
 * the Operator's own) and the app's slug. */
export type Changed = { space: string; app: string }

// The tools that put out a new version of an app, by the id a call points
// at (@yaks/tools `toolEid`), each with the argument that names the app.
// Writing files only stages them; app_deploy releases them.
let CHANGES = new Map(
  Object.entries({
    app_new: 'slug',
    app_deploy: 'app',
    app_rollback: 'app',
    app_update: 'app',
  }).map(([name, arg]) => [toolEid(name), arg]),
)

/** The apps these lines changed, oldest first: each call to a tool that puts
 * out a new version whose answer came back past `from` (by `entry.seq`) and
 * was not refused. An app named as space/app is that space's. */
export let changed = (entries: Bundle[], from = -1): Changed[] => {
  let calls = new Map(
    entries.filter((b) => b.call).map((b) => [b.entity.eid, comp(b, 'call')!]),
  )
  return entries.flatMap((b) => {
    if (!b.result || b.refusal || b.exception) return []
    if (Number(comp(b, 'entry')?.seq ?? 0) <= from) return []
    let call = calls.get(String(comp(b, 'result')!.call))
    let args = (call?.args ?? {}) as Record<string, unknown>
    let named = args[CHANGES.get(String(call?.to)) ?? '']
    if (typeof named != 'string' || !named) return []
    let [space, app] = named.includes('/')
      ? named.split('/', 2)
      : [typeof args.space == 'string' ? args.space : '', named]
    return [{ space, app }]
  })
}

/** One task's frame: the lines a step changed, what it is doing now, and
 * the apps it changed. */
export let frame = (
  task: string,
  entries: Bundle[],
  names: Names,
  from: number,
  seen: Seen = {},
) => ({
  operator: {
    task,
    rows: touched(entries, names, from, seen),
    changed: changed(entries, from),
    ...doingNow(entries, names),
  },
})

/** A helper's frame: what it was told past `from`, drawn inside the step
 * that started it (that step drawn again) or, for a helper no step drawn
 * started, on its own; the apps it changed; and what the Operator that
 * started it is doing now. */
export let helperFrame = (
  task: string,
  helper: Helper,
  entries: Bundle[],
  names: Names,
  from: number,
  seen: Seen = {},
) => {
  let seq = (id: string) =>
    Number(
      comp(helper.entries.find((b) => b.entity.eid == id), 'entry')?.seq ?? 0,
    )
  let told = helped(helper, seen.offers).filter((r) => seq(r.id) > from)
  let call = entries.some((b) => b.entity.eid == helper.call)
  return {
    operator: {
      task,
      rows: told.length && call
        ? rows(entries, names, { ...seen, helpers: [helper] })
          .filter((r) => r.id == helper.call)
        : told.map(drawn),
      changed: changed(helper.entries, from),
      ...doingNow(entries, names),
    },
  }
}

/** A task as its conversation draws it: every line, what it is doing now,
 * and the files sent with it. */
export let talk = (
  task: Bundle,
  entries: Bundle[],
  names: Names,
  files: { request: string; name: string; index: number }[],
  at: string,
  seen: Seen = {},
) => {
  let working = now(entries, names)
  // Files drawn under the words they came with are not listed again.
  let sent = new Set(
    entries.map((b) => comp(b, 'operator_files')?.request).filter(Boolean),
  )
  let rest = files.filter((f) => !sent.has(f.request))
  return renderToString(h(
    'div',
    {
      class: 'Talk_Thread',
      'data-task': task.entity.eid,
      'data-pending': working ? '' : undefined,
    },
    h(
      'div',
      { class: 'Talk_Said', 'data-rows': '' },
      lines(entries, names, seen).map((r) =>
        h('div', { id: `row-${r.id}` }, r.node)
      ),
    ),
    h(
      Loading,
      { class: 'Talk_Now' },
      h(Yak, { pose: poseOf(working) }),
      h('span', { 'data-now': '' }, working),
    ),
    rest.length
      ? h(
        'p',
        { class: 'Talk_Files' },
        rest.map((f) =>
          h(
            'a',
            { href: `${at}?attachment=${f.request}&file=${f.index}` },
            f.name,
          )
        ),
      )
      : null,
  ))
}

/** A piece of the Operator's work as its lists show it, in plain words. */
export type Worked = {
  /** what the page opens it by: a task, or a request no task has taken yet */
  open: string
  title: string
  state: string
  at: string
  busy: boolean
  /** for a helper, the title of the conversation that started it */
  from?: string
}

// What a task's newest session says of it, in the words its list shows.
export let stateOf = (entries: Bundle[], done: boolean) => {
  let status = statusOf(entries)
  if (status == 'failed') return 'Could not finish'
  if (status == 'stopped') return 'Stopped'
  if (status == 'settled') return done ? 'Done' : 'Answered'
  return status == 'empty' ? 'Waiting to start' : 'Working on it'
}

/** A conversation as a list shows it, with where it is when the list holds
 * more than one space's. */
export type Listed = Worked & { where?: string }

// A list across spaces says when each last changed, to the minute.
let meta = (w: Listed) =>
  [
    w.where,
    w.from && `Helper of the ${w.from[0].toLowerCase()}${w.from.slice(1)}`,
    w.state,
    w.where ? moment(w.at) : day(w.at, 'short'),
  ].filter(Boolean).join(' · ')

/** The Operator's conversations as rows, newest first, each a link to the
 * page `href` gives it. */
export let listed = <W extends Listed>(items: W[], href: (w: W) => string) =>
  renderToString(h(
    Rows,
    null,
    items.map((w) =>
      h(
        Rows.Item,
        { 'data-pending': w.busy ? '' : undefined },
        h(
          Rows.Main,
          null,
          h(Rows.Name, { href: href(w) }, w.title),
          h(Rows.Meta, null, meta(w)),
        ),
      )
    ),
  ))

/** Where the Operator's settings send a person for its conversations: the
 * chat app, which holds them. Settings list none (T-144779). */
export let talks = (space: string) =>
  h(
    Card,
    null,
    h(Card.Head, null, h(Card.Title, null, 'Conversations')),
    h(
      'p',
      null,
      'Your conversations with the Operator are in its chat. ',
      h(Button, { mod: 'go', href: chatPath(space) }, 'Open the chat'),
    ),
  )
