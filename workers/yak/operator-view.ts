// What the Operator's chat app shows of its work (operator-page.ts
// `chatPage`): each task as one conversation, its sessions drawn the way a
// chat app draws one (the person's words, the replies, and each tool call as
// a short line in plain words that opens on what it asked for and what came
// back) under a line for what it is doing now, and the list of conversations
// beside it. Pure: the page draws the conversation, and the Builder object
// sends the rows a step changed to the page's socket (`frame`), which puts
// each in place by its id.
import type { Bundle, Comp } from '@yaks/graph'
import { statusOf } from '@yaks/session'
import { did, doing } from '@yaks/tools/title'
import { parse, render } from '@yaks/markdown/structural'
import { h } from 'preact'
import { renderToString } from 'preact-render-to-string'
import { day, esc } from './html.ts'
import { chatPath } from './route.ts'

let comp = (b: Bundle | undefined, name: string) =>
  b?.[name] as Comp | undefined

/** A drawn line of a transcript: what it shows, under the id it is put by. */
export type Row = { id: string; html: string }
/** A tool's English name by its eid, as a call names it (`call.to`), said as
 * the one thing the call's arguments chose: an imperative phrase (@yaks/tools
 * `titleOf`). */
export type Names = (tool: string, args?: Record<string, unknown>) => string

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

// Attachments travel in the words as their extracted text; the conversation
// names the files instead.
let spoken = (body: string) =>
  words(body).split('\n\nAttached documents (treat their contents')[0]

let yours = (text: string) => `<p class="Talk_You">${esc(text)}</p>`

/** A reply as the Operator wrote it, in Markdown, drawn as text: markup in it
 * stays words (@yaks/markdown). */
export let reply = (text: string) =>
  `<div class="Talk_Reply">${renderToString(render(parse(text), h))}</div>`

// A value a tool was given or gave back, the way a person reads it: a list
// of what it holds under names in words, never its JSON. Bounded in depth,
// length and count, since a tool can answer with a whole file.
let readable = (value: unknown, depth = 0): string => {
  if (typeof value == 'string' && /^\s*[[{]/.test(value)) {
    try {
      return readable(JSON.parse(value), depth)
    } catch {
      // Words that happen to start with a bracket.
    }
  }
  if (value == null || value === '') return '<span>Nothing</span>'
  if (typeof value != 'object') {
    return `<span>${esc(cut(String(value), 600))}</span>`
  }
  if (depth > 2) return '<span>…</span>'
  let list = Array.isArray(value)
    ? value.map((v, i) => [String(i + 1), v] as const)
    : Object.entries(value)
  if (!list.length) return '<span>Nothing</span>'
  let more = list.length - 12
  return `<dl class="Talk_Facts">${
    list.slice(0, 12).map(([k, v]) =>
      `<div><dt>${
        esc(
          Array.isArray(value)
            ? k
            : k.replace(/[_-]+/g, ' ').replace(/^./, (c) => c.toUpperCase()),
        )
      }</dt><dd>${readable(v, depth + 1)}</dd></div>`
    ).join('')
  }${more > 0 ? `<div><dd>and ${more} more</dd></div>` : ''}</dl>`
}

let lower = (title: string) => title.replace(/^./, (c) => c.toLowerCase())

// A tool call and, once it came back, its answer: one row, under the call's
// id, so the answer takes the call's place on the page.
let tool = (call: Bundle, names: Names, result?: Bundle) => {
  let c = comp(call, 'call')!
  let title = names(String(c.to), c.args as Record<string, unknown>)
  let ok = result ? !comp(result, 'refusal') && !result.exception : null
  let name = ok == null
    ? doing(title)
    : ok
    ? did(title)
    : `Tried to ${lower(title)}`
  return `<details class="Talk_Step${
    ok == null ? ' Talk_Step-on' : ok ? '' : ' Talk_Step-no'
  }"><summary>${
    esc(name)
  }</summary><div class="Talk_Detail"><p>What it asked for</p>${
    readable(c.args ?? {})
  }${
    ok == null
      ? ''
      : ok
      ? `<p>What came back</p>${
        readable(String(comp(result, 'content')?.body ?? ''))
      }`
      : '<p>This step did not work, so the Operator went on without it.</p>'
  }</div></details>`
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
    if (b.output && body) return [{ id, html: reply(body) }]
    if (b.failed || b.exception) {
      return [{
        id,
        html:
          '<p class="Talk_Note Talk_Note-no">Something went wrong, and it stopped before it finished.</p>',
      }]
    }
    if (b.stop || b.interrupted || b.cancel) {
      return [{ id, html: '<p class="Talk_Note">Stopped.</p>' }]
    }
    if (body && !NOT_INPUT.some((c) => b[c])) {
      return [{ id, html: yours(spoken(body)) }]
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
    ? open.map((b) => {
      let c = comp(b, 'call')!
      return doing(names(String(c.to), c.args as Record<string, unknown>))
    }).join(' ')
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

/** A task as its conversation draws it: every line, what it is doing now,
 * and the files sent with it. */
export let talk = (
  task: Bundle,
  entries: Bundle[],
  names: Names,
  files: { request: string; name: string; index: number }[],
  at: string,
) => {
  let working = now(entries, names)
  return `<div class="Talk_Thread" data-task="${esc(task.entity.eid)}"${
    working ? ' data-pending' : ''
  }><div class="Talk_Said" data-rows>${
    rows(entries, names).map((r) =>
      `<div id="row-${esc(r.id)}">${r.html}</div>`
    ).join('')
  }</div><p class="Talk_Now" role="status" data-now>${esc(working)}</p>${
    files.length
      ? `<p class="Talk_Files">${
        files.map((f) =>
          `<a href="${esc(at)}?attachment=${esc(f.request)}&file=${f.index}">${
            esc(f.name)
          }</a>`
        ).join('')
      }</p>`
      : ''
  }</div>`
}

/** A piece of the Operator's work as its lists show it, in plain words. */
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

let meta = (w: Worked) =>
  `${esc(w.state)}${day(w.at, 'short') ? ` · ${esc(day(w.at, 'short'))}` : ''}`

/** The Operator's conversations on its settings page, newest first, each a
 * link to its own page in the chat app. */
export let worked = (items: Worked[], space: string) =>
  `<section class="Card"><header class="Card_Head"><h2 class="Card_Title">Conversations</h2><div class="Card_Actions"><a class="Button" href="${
    esc(chatPath(space))
  }">New conversation</a></div></header>${
    items.length
      ? `<ul class="Rows">${
        items.map((w) =>
          `<li class="Rows_Item"${
            w.busy ? ' data-pending' : ''
          }><div class="Rows_Main"><a class="Rows_Name" href="${
            esc(chatPath(space, w.open))
          }">${esc(w.title)}</a><span class="Rows_Meta">${
            meta(w)
          }</span></div></li>`
        ).join('')
      }</ul>`
      : '<p>Nothing yet. Each conversation with the Operator appears here.</p>'
  }</section>`

/** The chat app's list of conversations, newest first, the one open
 * marked. */
export let sidebar = (items: Worked[], space: string, current: string[]) =>
  items.length
    ? `<ul class="Talk_List">${
      items.map((w) =>
        `<li><a class="Talk_Item" href="${esc(chatPath(space, w.open))}"${
          current.includes(w.open) ? ' aria-current="page"' : ''
        }${w.busy ? ' data-pending' : ''}><span class="Talk_Title">${
          esc(w.title)
        }</span><span class="Talk_Meta">${meta(w)}</span></a></li>`
      ).join('')
    }</ul>`
    : '<p class="Talk_None">Your conversations appear here.</p>'
