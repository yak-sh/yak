// A person's words stored before `operator_channel` (T-141017) carry the
// framing the model read before them at the start of their body, and nothing
// saying which channel they came by: each such row is given its channel and
// framing, read off the framing itself. A line a call's talking model said,
// stored before the Operator read those as its own (T-144809), was framed as
// a person's words ("On the phone, you said: "), which the Operator took for
// the caller quoting it: each is made the Operator's own words. The private
// Operator graph is moved in bounded writes during its work, never in Durable
// Object boot, once an isolate.
import type { Bundle, Comp, Graph } from '@yaks/graph'
import { channelOf } from './operator-view.ts'

// Each channel's framing as operator-channels.ts `BY` and operator.ts `note`
// wrote it, the person's words after it.
let FRAMED: [string, RegExp][] = [
  ['voice', /^By phone, spoken aloud \([^)]*\): /],
  ['voice', /^By phone: /],
  ['voice', /^On the phone, you said: /],
  [
    'letter',
    /^By email from [^\n]*?, replying to your letter \(letter [^)]+\)\. These are their words, not the words of the person you work for: /,
  ],
  [
    'texted',
    /^By text from [^\n]*?, replying to your text \(text [^)]+\)\. These are their words, not the words of the person you work for: /,
  ],
  ['email', /^By email(, signing up)?: /],
  ['text', /^By text(, signing up)?: /],
  [
    'update',
    /^In their Updates, (choosing on your question “[\s\S]*?”|replying to your update “[\s\S]*?”) \([^)]+\): /,
  ],
  ['chat', /^About the app [^,]+, open beside the chat as they wrote: /],
]

let FIND = `.entry&!operator_channel&!output&!result&(${
  [
    'By phone',
    'On the phone, you said',
    'By email',
    'By text',
    'In their Updates',
    'open beside the chat as they wrote',
  ].map((s) => `.content.body~=${JSON.stringify(s)}`).join('|')
})`

let OLD = '.operator_call.said=true&.operator_channel&?content'

// A task's first words are its row as JSON (operator.ts `ask`).
let wordsOf = (body: string) => {
  try {
    let task = body.startsWith('{') ? JSON.parse(body).task : undefined
    let doc = task?.doc ?? task
    return typeof doc?.body == 'string' ? doc.body : body
  } catch {
    return body
  }
}

/** The patch that gives one row its channel, if its words start framed. */
export let channelMove = (row: Bundle): Bundle[] => {
  let words = wordsOf(String((row.content as Comp | undefined)?.body ?? ''))
  for (let [channel, framed] of FRAMED) {
    let framing = words.match(framed)?.[0]
    if (framing) {
      return [{
        entity: row.entity,
        operator_channel: channelOf(channel, framing),
      }]
    }
  }
  return []
}

let SAID = 'On the phone, you said: '

/** The patch that makes a talking model's old line the Operator's own. */
export let saidMove = (row: Bundle): Bundle[] => {
  let body = String((row.content as Comp | undefined)?.body ?? '')
  return body.startsWith(SAID)
    ? [{
      entity: row.entity,
      content: { body: body.slice(SAID.length) },
      notice: { own: true },
      operator_channel: null,
    }]
    : []
}

let moved = new WeakSet<Graph>()

/** Every framed row of `g` given its channel, and every old line a talking
 * model said made the Operator's own, once an isolate. */
export let channeled = async (g: Graph) => {
  if (moved.has(g)) return
  moved.add(g)
  for (let [find, move] of [[FIND, channelMove], [OLD, saidMove]] as const) {
    let rows = (await g.read(find)).flatMap(move)
    for (let i = 0; i < rows.length; i += 50) {
      await g.apply(rows.slice(i, i + 50), { trusted: true, stamp: false })
    }
  }
}
