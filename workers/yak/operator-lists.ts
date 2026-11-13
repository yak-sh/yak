// The lists the MCP servers a person connected offer, drawn beside their
// conversation with their Operator with no model turn (D-153799, The chair;
// talk-beside.ts). Each is a row on the directory (`doc{title}` +
// `mcp_list{server, tool, args, waits, ord}`, directory-vocab.ts, set by
// `mcp_connect`'s `lists`), and is read by one call each time the page is
// drawn, all at once. The page knows nothing of what the rows are beyond the
// words they carry: a title, a line, and the choices a row offers, each
// answered as the person's own act through the door their relayed words take
// (operator-relay.ts `answerAsTheirs`); an answer of words alone is drawn as
// its lines. A server on a machine that is off is said to be, and the page is
// drawn anyway.
import type { Bundle, Comp } from '@yaks/graph'
import { short } from '@yaks/id'
import { type ComponentChildren as Node, h } from 'preact'
import { Badge, Button, Card, Empty, More, Rows } from '@yaks/ui/parts'
import { runConnectedCommands } from './connected-mcp.ts'
import type { Asked } from './mcp-remote.ts'
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

/** One list as its server answered it, or why it answered none: `off` says
 * so in the platform's words. `asks` are the rows an answer gave, `lines` the
 * words of an answer that gave none. The read's wait is the page's
 * `machine_wait` (timing.ts). */
export type Listed = {
  server: string
  title: string
  waits: boolean
  asks: Ask[]
  lines: string[]
  off?: string
}

/** What the person's servers offer the page beside the conversation: their
 * lists, and where an id their rows carry opens, `{id}` where it goes
 * (`mentions{url}` on the first server's row that says). */
export type Beside = { lists: Listed[]; mentions?: string }

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
 * import { askOf } from './operator-lists.ts'
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

// The servers of `person`'s that this space's Operator reaches, with their
// lists in order: one on a machine is reached only by the Operator of the
// space whose tunnel goes there (tunnel.ts `machine`).
let listings = async (env: Env, person: string, space: string) => {
  let { servers, lists } = await directoryOf(env.STORE).listings(person)
  let reached = servers.filter((server) => {
    let { enabled, machine } = comp(server, 'mcp_server')
    return enabled !== false && (!machine || machine == space)
  })
  let at = new Map(reached.map((s) => [s.entity.eid, s]))
  return {
    servers: reached,
    lists: lists.flatMap((list) => {
      let server = at.get(String(comp(list, 'mcp_list').server))
      return server ? [{ list, server }] : []
    }).toSorted((a, z) =>
      Number(comp(a.list, 'mcp_list').ord ?? 0) -
      Number(comp(z.list, 'mcp_list').ord ?? 0)
    ),
  }
}

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

// A list's arguments as stored: a JSON object, or none.
let argsOf = (said: unknown): Record<string, unknown> => {
  try {
    let args = JSON.parse(String(said ?? '{}'))
    return args && typeof args == 'object' && !Array.isArray(args) ? args : {}
  } catch {
    return {}
  }
}

// A list that could not be read: a machine that is off is said to be;
// anything else is reported, and the page is drawn all the same.
let unread = (listed: Listed, e: unknown): Listed => {
  if (!(e instanceof CallError)) caught(e, { request: 'lists' })
  return {
    ...listed,
    off: e instanceof CallError ? e.message : 'it could not be read',
  }
}

// A list as its server answered it.
let heard = (listed: Listed, asked: Asked): Listed => {
  if ('error' in asked) return unread(listed, asked.error)
  let { out } = asked
  let rows = (out.value?.structuredContent as { result?: Bundle[] } | undefined)
    ?.result
  if (out.value?.isError || out.value?.unavailable || !Array.isArray(rows)) {
    return { ...listed, off: out.text }
  }
  let things = rows.filter((b) => !b.entity.eid.startsWith('$'))
  return {
    ...listed,
    asks: things.map(askOf),
    lines: things.length ? [] : said(rows),
  }
}

// The lists one server offers, read as `space`'s Operator, which is whom a
// machine opens its tools to: all at once on one connection, so a machine
// behind a tunnel is opened once for the page and not once a list.
let served = async (
  env: Env,
  person: string,
  space: string,
  row: Bundle,
  lists: Bundle[],
  wait: number,
): Promise<Listed[]> => {
  let server = `mcp:${row.entity.eid}`
  let listed = lists.map((list): Listed => ({
    server,
    title: String(comp(list, 'doc').title ?? ''),
    waits: comp(list, 'mcp_list').waits === true,
    asks: [],
    lines: [],
  }))
  try {
    let asked = await within(
      runConnectedCommands(
        theirs(env, person),
        server,
        lists.map((list) => {
          let { tool, args } = comp(list, 'mcp_list')
          return { name: String(tool), args: argsOf(args) }
        }),
        { caller: 'operator', space },
      ),
      wait,
    )
    return listed.map((l, i) => heard(l, asked[i]))
  } catch (e) {
    // The server as a whole failed: each of its lists says so, and it is
    // reported once.
    let off = unread(listed[0], e).off
    return listed.map((l) => ({ ...l, off }))
  }
}

// The lines of what an answer said in words.
let said = (rows: Bundle[]) =>
  rows.flatMap((b) => String(comp(b, 'content').body ?? '').split('\n'))
    .map((l) => l.trim()).filter(Boolean)

/** What `person`'s servers offer `space`'s Operator page, in two steps: how
 * many lists it reaches and where their ids open, from the directory, and
 * `read`, which asks every server at once and gives each list in its order.
 * A page draws without waiting on `read` (operator-page.ts `chatPage`). */
export type Listing = {
  size: number
  mentions?: string
  read: (wait?: number) => Promise<Listed[]>
}

export let listingOf = async (
  env: Env,
  person: string | null | undefined,
  space: string,
): Promise<Listing> => {
  if (!person) return { size: 0, read: () => Promise.resolve([]) }
  let { servers, lists } = await listings(env, person, space)
  let mentions = servers.map((s) => String(comp(s, 'mentions').url ?? ''))
    .find(Boolean)
  // Each server's lists together, then all of them back in their order.
  let read = async (wait = WAIT) => {
    let groups = Map.groupBy(lists, (l) => l.server.entity.eid).values()
    let got = new Map(
      (await Promise.all([...groups].map(async (group) => {
        let listed = await served(
          env,
          person,
          space,
          group[0].server,
          group.map((l) => l.list),
          wait,
        )
        return group.map((l, i) => [l.list, listed[i]] as const)
      }))).flat(),
    )
    return lists.map((l) => got.get(l.list)!)
  }
  return { size: lists.length, ...mentions ? { mentions } : {}, read }
}

/** What `person`'s servers offer `space`'s Operator page: each list read at
 * once and in their order, and where their ids open; nothing where they set
 * nothing it reaches. */
export let listsOf = async (
  env: Env,
  person: string | null | undefined,
  space: string,
  wait = WAIT,
): Promise<Beside> => {
  let { mentions, read } = await listingOf(env, person, space)
  return { lists: await read(wait), ...mentions ? { mentions } : {} }
}

/** The id of an ask's row on the page, which an alert about it opens at
 * (operator-alerts.ts `openAt`). */
export let askAnchor = (eid: string) => `ask-${eid}`

/**
 * How many things need the person, as the bar beside their conversation
 * counts them (talk-beside.ts `counted`): the rows of the lists that wait on
 * them, then their Updates that ask them something.
 *
 * ```ts
 * import { equal } from '@yaks/testing'
 * import { needCount } from './operator-lists.ts'
 * let ask = { eid: 'e', title: 'T', ask: '', choices: [] }
 * let list = { server: 's', title: 'L', waits: true, asks: [ask, ask], lines: [] }
 * let updates = [{ needs: true }, { needs: false }]
 * equal(needCount([list, { ...list, waits: false }], updates), 3)
 * equal(needCount([{ ...list, asks: [], off: 'it is off' }], updates), 1)
 * equal(needCount([], []), 0)
 * ```
 */
export let needCount = (
  lists: Listed[],
  updates: { needs: boolean }[],
) =>
  lists.reduce((n, l) => n + (l.waits ? l.asks.length : 0), 0) +
  updates.filter((u) => u.needs).length

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
// comes back to `back`, the page it was pressed on. A row that waits on the
// person is where an alert about it opens.
let row = (
  a: Ask,
  action: string,
  server: string,
  back: string,
  waits: boolean,
) =>
  h(
    Rows.Item,
    {
      as: 'li',
      class: 'Asks_Item',
      ...waits ? { id: askAnchor(a.eid) } : {},
    },
    h(
      Rows.Main,
      null,
      // a line for what it is and a line for what it asks, each cut where
      // it runs out of room, its title saying the rest
      h(Rows.Name, { mod: 'line', title: a.title }, a.title),
      a.ask && a.ask != a.title
        ? h(Rows.Meta, { mod: 'line', title: a.ask }, a.ask)
        : null,
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
 * One list beside the conversation under its title: the first `SHOWN` rows,
 * the rest folded under one line that says how many, or the lines it said,
 * or that their machine did not answer; nothing where it holds nothing.
 * `action` is where a choice is sent, and `back` the page it returns to.
 */
export let listOf = (listed: Listed, action: string, back: string): List => {
  let { asks, lines, off, server, title, waits } = listed
  let more = asks.length - SHOWN
  let rows = (some: Ask[]) =>
    h(
      Rows,
      { as: 'ul', class: 'Asks' },
      some.map((a) => row(a, action, server, back, waits)),
    )
  let card = (...body: Node[]) =>
    h(
      Card,
      { class: 'Talk_List' },
      h(
        Card.Head,
        {},
        h(Card.Title, { as: 'h3' }, title),
        waits ? h(Badge, null, asks.length) : null,
      ),
      ...body,
    )
  return {
    count: waits ? asks.length : 0,
    node: off
      ? h(
        Empty,
        { class: 'Talk_List' },
        h('p', null, `Your machine is off, so ${title} can’t be read now.`),
        h('p', { class: 'Talk_List_Why' }, off),
      )
      : asks.length
      ? card(
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
      : lines.length
      ? card(
        h(
          Rows,
          { as: 'ul', class: 'Asks' },
          lines.map((l) =>
            h(
              Rows.Item,
              { as: 'li' },
              h(Rows.Name, { mod: 'line', title: l }, l),
            )
          ),
        ),
      )
      : null,
  }
}
