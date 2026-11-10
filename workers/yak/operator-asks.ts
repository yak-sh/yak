// What needs a person, listed beside their conversation with their Operator
// with no model turn (D-153799, item 6; talk-beside.ts): the rows one MCP server they connected answers
// (`asks{tool, query}` on its `mcp_server` row, directory-vocab.ts), read by
// one call each time the page is drawn, in the order the server gives them.
// The page knows nothing of what the rows are beyond the words they carry: a
// title, what is asked, and the choices a row offers, each answered as the
// person's own act through the door their relayed words take
// (operator-relay.ts `answerAsTheirs`). A server on a machine that is off is
// said to be, and the page is drawn anyway.
import type { Bundle, Comp } from '@yaks/graph'
import { short } from '@yaks/id'
import { h } from 'preact'
import { Button, Card, Empty, More, Rows } from '@yaks/ui/parts'
import { runConnectedCommand } from './connected-mcp.ts'
import { caught } from './defects.ts'
import { directoryOf } from './directory.ts'
import type { Env } from './env.ts'
import { answerAsTheirs } from './operator-relay.ts'
import type { List } from './talk-beside.ts'
import { CallError } from '@yaks/tools/errors'
import { type Ctx, refuse } from './tool.ts'

/** One thing that needs the person: what it is called, what it asks of
 * them in a line, and the choices it offers, the recommended one first. */
export type Ask = {
  eid: string
  title: string
  ask: string
  choices: { label: string; description: string }[]
}

/** The list a person's server answered, or why it answered none: `off` says
 * so in the platform's words. The read's wait is the page's `machine_wait`
 * (timing.ts). */
export type Listed = {
  server: string
  asks: Ask[]
  off?: string
}

/** How many show before the rest wait behind one press. */
export let SHOWN = 10

/** How long the page waits on the server before saying it did not answer. */
export let WAIT = 3000

let comp = (b: Bundle, name: string) => (b[name] ?? {}) as Comp

// The first line a body says, without the marks Markdown puts at its start.
let line = (body: unknown) =>
  String(body ?? '').split('\n').map((l) =>
    l.replace(/^\s*(#+|[-*]|\d+\.)\s+/, '').trim()
  ).find(Boolean) ?? ''

/**
 * A row the server answered, as the page draws it.
 *
 * ```ts
 * import { equal } from '@yaks/testing'
 * import { askOf } from './operator-asks.ts'
 * equal(askOf({
 *   entity: { eid: 'e' },
 *   doc: { title: 'Pick a day', body: 'Long words.' },
 *   decision: {
 *     question: 'Which day?',
 *     choices: [{ label: 'Fri', description: 'Soon' }, { label: 'Mon' }],
 *     recommended: 'Mon',
 *   },
 * }), {
 *   eid: 'e',
 *   title: 'Pick a day',
 *   ask: 'Which day?',
 *   choices: [
 *     { label: 'Mon', description: '' },
 *     { label: 'Fri', description: 'Soon' },
 *   ],
 * })
 * equal(
 *   askOf({ entity: { eid: 'e' }, doc: { title: 'T', body: '\n1. Open it.\n2. Save.' } }).ask,
 *   'Open it.',
 * )
 * ```
 */
export let askOf = (b: Bundle): Ask => {
  let doc = comp(b, 'doc'), decision = comp(b, 'decision')
  let choices = ((decision.choices ?? []) as Comp[]).map((c) => ({
    label: String(c.label ?? ''),
    description: String(c.description ?? ''),
  })).filter((c) => c.label)
  return {
    eid: b.entity.eid,
    title: String(doc.title ?? '') || line(doc.body),
    ask: line(decision.question) || line(doc.body),
    choices: choices.toSorted((a, z) =>
      +(z.label == decision.recommended) - +(a.label == decision.recommended)
    ),
  }
}

// The person's server that lists what needs them, where they named one that
// this space's Operator reaches: one on a machine is reached only by the
// Operator of the space whose tunnel goes there (tunnel.ts `machine`).
let listing = async (env: Env, person: string, space: string) =>
  (await directoryOf(env.STORE).listings(person))
    .find((b) => {
      let { enabled, machine } = comp(b, 'mcp_server')
      return enabled !== false && (!machine || machine == space)
    })

// The tools' context for the person themselves, as a page of theirs calls.
let theirs = (env: Env, person: string): Ctx =>
  ({ env, dir: directoryOf(env.STORE), person }) as unknown as Ctx

// The read raced against `WAIT`: a machine that hangs is one that is off.
let within = <T>(work: Promise<T>, wait: number) =>
  Promise.race([
    work,
    new Promise<never>((_, no) =>
      setTimeout(() => no(refuse('unavailable', 'it did not answer')), wait)
    ),
  ])

/** What needs `person`, from the server they named for it, or null where they
 * named none that `space`'s Operator reaches. Asked as that Operator, which is
 * whom a machine opens its tools to. */
export let asksOf = async (
  env: Env,
  person: string | null | undefined,
  space: string,
  wait = WAIT,
): Promise<Listed | null> => {
  if (!person) return null
  let row = await listing(env, person, space)
  if (!row) return null
  let { tool, query } = comp(row, 'asks')
  let server = `mcp:${row.entity.eid}`
  try {
    let out = await within(
      runConnectedCommand(
        theirs(env, person),
        server,
        String(tool),
        query ? { query: String(query) } : {},
        { caller: 'operator', space },
      ),
      wait,
    )
    let rows =
      (out.value?.structuredContent as { result?: Bundle[] } | undefined)
        ?.result
    if (out.value?.isError || out.value?.unavailable || !Array.isArray(rows)) {
      return { server, asks: [], off: out.text }
    }
    return { server, asks: rows.map(askOf) }
  } catch (e) {
    // A machine that is off is said to be; anything else is reported, and the
    // page is drawn all the same.
    if (!(e instanceof CallError)) caught(e, { request: 'asks' })
    return {
      server,
      asks: [],
      off: e instanceof CallError ? e.message : 'it could not be read',
    }
  }
}

/** The id of an ask's row on the page, which an alert about it opens at
 * (operator-alerts.ts `openAt`). */
export let askAnchor = (eid: string) => `ask-${eid}`

/**
 * How many things need the person, as the bar beside their conversation
 * counts them (talk-beside.ts `counted`): what their server listed, then
 * their Updates that ask them something.
 *
 * ```ts
 * import { equal } from '@yaks/testing'
 * import { needCount } from './operator-asks.ts'
 * let ask = { eid: 'e', title: 'T', ask: '', choices: [] }
 * let updates = [{ needs: true }, { needs: false }]
 * equal(needCount({ server: 's', asks: [ask, ask] }, updates), 3)
 * equal(needCount({ server: 's', asks: [], off: 'it is off' }, updates), 1)
 * equal(needCount(null, []), 0)
 * ```
 */
export let needCount = (
  listed: Listed | null,
  updates: { needs: boolean }[],
) => (listed?.asks.length ?? 0) + updates.filter((u) => u.needs).length

/** The person's press of a choice beside a row on `space`'s Operator page:
 * their answer, as theirs. */
export let answered = (
  env: Env,
  person: string,
  space: string,
  server: string,
  ask: string,
  choice: string,
) => answerAsTheirs(theirs(env, person), space, server, ask, choice)

// One row: what it is and what it asks, each a line, then its choices and a
// way to answer in their own words, which fills the message box. A choice
// comes back to `back`, the page it was pressed on.
let row = (a: Ask, action: string, server: string, back: string) =>
  h(
    Rows.Item,
    { as: 'li', class: 'Asks_Item', id: askAnchor(a.eid) },
    h(
      Rows.Main,
      null,
      h(Rows.Name, { title: a.title }, a.title),
      a.ask && a.ask != a.title ? h(Rows.Meta, { title: a.ask }, a.ask) : null,
    ),
    h(
      Rows.Actions,
      null,
      a.choices.length
        ? h(
          Rows.Form,
          { method: 'post', action },
          h('input', { type: 'hidden', name: 'server', value: server }),
          h('input', { type: 'hidden', name: 'ask', value: a.eid }),
          h('input', { type: 'hidden', name: 'back', value: back }),
          a.choices.map((c, i) =>
            h(Button, {
              mod: !i && 'go',
              name: 'choice',
              value: c.label,
              title: c.description || undefined,
            }, c.label)
          ),
        )
        : null,
      h(Button, {
        type: 'button',
        'data-say': `About “${a.title}” (${short(a.eid)}): `,
      }, 'Reply'),
    ),
  )

/**
 * The list beside the conversation: the first `SHOWN` rows, the rest folded
 * under one line that says how many, or that their machine did not answer;
 * nothing where nothing needs them. `action` is where a choice is sent, and
 * `back` the page it returns to.
 */
export let asksList = (listed: Listed, action: string, back: string): List => {
  let { asks, off, server } = listed
  let more = asks.length - SHOWN
  let rows = (some: Ask[]) =>
    h(
      Rows,
      { as: 'ul', class: 'Asks' },
      some.map((a) => row(a, action, server, back)),
    )
  return {
    count: asks.length,
    node: off
      ? h(
        Empty,
        { class: 'Talk_Asks' },
        h(
          'p',
          null,
          'Your machine is off, so what needs you can’t be listed now.',
        ),
        h('p', { class: 'Talk_Asks_Why' }, off),
      )
      : asks.length
      ? h(
        Card,
        { class: 'Talk_Asks' },
        rows(asks.slice(0, SHOWN)),
        more > 0
          ? h(
            More,
            null,
            h(More.Summary, null, `${more} more`),
            h(More.Body, null, rows(asks.slice(SHOWN))),
          )
          : null,
      )
      : null,
  }
}
