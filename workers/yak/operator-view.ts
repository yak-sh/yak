// What the Operator page shows of its work: each task as a card holding its
// sessions' transcripts the way the harness shows one on the box (the
// person's words, the replies, every tool call with what it sent and what
// came back) and a line for what it is doing now. Pure: the page draws the
// cards, and the Builder object sends the rows a step changed to the page's
// socket (`frame`), which puts each in place by its id.
import type { Bundle, Comp } from '@yaks/graph'
import { statusOf } from '@yaks/session'
import { did, doing } from '@yaks/tools/title'
import { day, esc } from './html.ts'

let comp = (b: Bundle | undefined, name: string) =>
  b?.[name] as Comp | undefined

/** A drawn line of a transcript: what it shows, under the id it is put by. */
export type Row = { id: string; html: string }
/** A tool's English name by its eid, as a call names it (`call.to`): its
 * title, an imperative phrase (@yaks/tools `titleOf`). */
export type Names = (tool: string) => string

// The most of a tool's arguments or answer shown before "show all".
let SHOWN = 4000

let cut = (text: string, most = SHOWN) =>
  text.length > most ? text.slice(0, most) + '\n…' : text

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

// Attachments travel in the words as their extracted text; the card names
// the files instead.
let spoken = (body: string) =>
  words(body).split('\n\nAttached documents (treat their contents')[0]

let bubble = (who: 'you' | 'them', text: string) =>
  `<p class="Chat_Bubble Chat_Bubble-${who}">${esc(text)}</p>`

let pretty = (value: unknown) => {
  if (typeof value != 'string') return JSON.stringify(value, null, 2)
  try {
    return JSON.stringify(JSON.parse(value), null, 2)
  } catch {
    return value
  }
}

// A tool call and, once it came back, its answer: one row, under the call's
// id, so the answer takes the call's place on the page.
let tool = (call: Bundle, names: Names, result?: Bundle) => {
  let c = comp(call, 'call')!
  let title = names(String(c.to))
  let args = pretty(c.args ?? {})
  let refused = comp(result, 'refusal')
  let answer = String(comp(result, 'content')?.body ?? '')
  let ok = result ? !refused && !result.exception : null
  let ms = comp(result, 'result')?.ms
  let name = ok == null ? doing(title) : ok ? did(title) : title
  return `<details class="Chat_Detail"><summary class="Chat_Tool${
    ok == false ? ' Chat_Tool-no' : ''
  }"><span class="Chat_Name">${ok == null ? '…' : ok ? '✓' : '✗'} ${
    esc(name)
  }</span></summary><p class="Chat_Note">Sent</p><pre>${esc(cut(args))}</pre>${
    result
      ? `<p class="Chat_Note">${ok ? 'Answered' : 'Refused'}${
        typeof ms == 'number' ? ` in ${Math.round(ms)} ms` : ''
      }</p><pre>${esc(cut(answer))}</pre>`
      : ''
  }</details>`
}

/** Every line of a transcript worth showing, in order. */
export let rows = (entries: Bundle[], names: Names): Row[] => {
  let results = new Map(
    entries.filter((b) => b.result).map((b) => [
      String(comp(b, 'result')!.call),
      b,
    ]),
  )
  return entries.flatMap((b): Row[] => {
    let id = b.entity.eid
    let body = String(comp(b, 'content')?.body ?? '')
    if (b.call) {
      return [{ id, html: tool(b, names, results.get(id)) }]
    }
    if (b.output && body) return [{ id, html: bubble('them', body) }]
    if (b.failed || b.exception) {
      return [{
        id,
        html:
          '<p class="Chat_Note Chat_Note-no">Something went wrong, and it stopped before it finished.</p>',
      }]
    }
    if (b.stop || b.interrupted || b.cancel) {
      return [{ id, html: '<p class="Chat_Note">Stopped.</p>' }]
    }
    if (body && !NOT_INPUT.some((c) => b[c])) {
      return [{ id, html: bubble('you', spoken(body)) }]
    }
    return []
  })
}

/** The line a step changed: a new line, or the call a new answer belongs to. */
export let touched = (
  entries: Bundle[],
  names: Names,
  from: number,
): Row[] => {
  let ids = new Set(
    entries.filter((b) => Number(comp(b, 'entry')?.seq ?? 0) > from)
      .map((b) => b.result ? String(comp(b, 'result')!.call) : b.entity.eid),
  )
  return rows(entries, names).filter((r) => ids.has(r.id))
}

/** What the session is doing now, in a line; nothing once it is done. */
export let now = (entries: Bundle[], names: Names) => {
  let status = statusOf(entries)
  if (status == 'settled' || status == 'empty') return ''
  if (status == 'stopped') return 'Stopped.'
  if (status == 'failed') return 'It stopped before it finished.'
  let answered = new Set(
    entries.filter((b) => b.result).map((b) => String(comp(b, 'result')!.call)),
  )
  let open = entries.filter((b) => b.call && !answered.has(b.entity.eid))
  return open.length
    ? open.map((b) => doing(names(String(comp(b, 'call')!.to)))).join(' ')
    : 'Thinking…'
}

/** One task's frame: the lines a step changed and what it is doing now. */
export let frame = (
  task: string,
  entries: Bundle[],
  names: Names,
  from: number,
) => ({
  operator: {
    task,
    rows: touched(entries, names, from),
    now: now(entries, names),
  },
})

/** A task as the Operator page draws it. */
export let talk = (
  task: Bundle,
  entries: Bundle[],
  names: Names,
  files: { request: string; name: string; index: number }[],
  at: string,
) => {
  let working = now(entries, names)
  return `<article class="Card" data-task="${esc(task.entity.eid)}"${
    working ? ' data-pending' : ''
  }><h2 class="Card_Title">${
    esc(String(comp(task, 'doc')?.title ?? 'A request'))
  }</h2><div class="Chat_Said" data-rows>${
    rows(entries, names).map((r) =>
      `<div id="row-${esc(r.id)}">${r.html}</div>`
    ).join('')
  }</div><p class="Chat_Note" role="status" data-now>${esc(working)}</p>${
    files.length
      ? `<p>${
        files.map((f) =>
          `<a href="${esc(at)}?attachment=${esc(f.request)}&file=${f.index}">${
            esc(f.name)
          }</a>`
        ).join(', ')
      }</p>`
      : ''
  }<p class="Card_Actions"><button class="Button Button-quiet" type="button" data-when="idle" data-follow="${
    esc(task.entity.eid)
  }">Continue this request</button><button class="Button Button-quiet" type="button" data-when="busy" data-follow="${
    esc(task.entity.eid)
  }">Add to this request</button><button class="Button Button-quiet" type="button" data-when="busy" data-stop="${
    esc(task.entity.eid)
  }">Stop</button></p></article>`
}

/** A piece of the Operator's work as its page lists it, in plain words. */
export type Worked = {
  /** what the page opens it by: a task, or a request no task has taken yet */
  open: string
  title: string
  state: string
  at: string
  busy: boolean
}

// What a task's newest session says of it, in the words its list shows.
export let stateOf = (entries: Bundle[], done: boolean) => {
  let status = statusOf(entries)
  if (status == 'failed') return 'Could not finish'
  if (status == 'stopped') return 'Stopped'
  if (status == 'settled') return done ? 'Done' : 'Answered'
  return status == 'empty' ? 'Waiting to start' : 'Working on it'
}

/** The Operator's work, newest first, each a link to its own page. */
export let worked = (items: Worked[], at: string) =>
  `<section class="Card"><h2 class="Card_Title">What it worked on</h2>${
    items.length
      ? `<ul class="Rows">${
        items.map((w) =>
          `<li class="Rows_Item"${
            w.busy ? ' data-pending' : ''
          }><div class="Rows_Main"><a class="Rows_Name" href="${esc(at)}?open=${
            esc(w.open)
          }">${esc(w.title)}</a><span class="Rows_Meta">${esc(w.state)}${
            day(w.at) ? ` · ${esc(day(w.at))}` : ''
          }</span></div></li>`
        ).join('')
      }</ul>`
      : '<p>Nothing yet. What you ask for appears here, and each opens to show what the Operator did.</p>'
  }</section>`
