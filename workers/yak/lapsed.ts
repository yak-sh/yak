// An assistant that lost its sign-in to yaks.app, and its person told how to
// connect it again, once (T-123498).
//
// A person finds out their assistant lost its sign-in when it says it cannot
// reach yaks.app. The token door sees the same moment: a refresh it refuses,
// the assistant coming back with a refresh token, `<person>:<grant>:<secret>`,
// for a grant that is gone. When the person holds no other sign-in for that
// assistant, the door records a `lapsed{person, agent}` row in the directory,
// and the row's `tell_lapsed` effect writes to them
// (facets/lapsed-effects.ts).
//
// The row is the once. Its eid is derived from the person and the assistant,
// so every later refusal lands on the same row and owes nothing, until the
// person connects that assistant again and the row goes (`reconnected`). A row
// whose `agent` is `any` is a lapse whose assistant nobody knows, written by
// the platform's admin for the sign-ins that ran out before this door watched
// (`yak admin apply yak/platform`); it stands for every assistant, so its
// person is not written to again by the door. A person who disconnects an
// assistant themselves knows already (`closed`).
//
// A refresh token is a string anybody can make up, so the person it names is
// only believed as far as the rule allows: one letter per assistant until the
// person connects it again, and only to a person the directory knows.
import type { Bundle } from '@yaks/graph'
import { agentOf, agentsOf, type Clients } from './connected.ts'
import { KERNEL, type Meta } from './meta.ts'
import { type Host, url } from './host.ts'
import { managePath } from './route.ts'

type Rows = Pick<Meta, 'query' | 'apply'>

// A person's eid as the graph mints it; anything else in a token names
// nobody, and never reaches a query line.
let EID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

let rowsOf = (store: Rows, person: string) =>
  store.query(`.lapsed.person=${person}`)

/** The `agent` of a lapse whose assistant nobody knows. */
export let ANY = 'any'

let agentIn = (row: Bundle) => (row.lapsed as { agent?: string }).agent

/**
 * Whether losing `agent` is news to its person: they hold no sign-in for it
 * now, and no lapse of it, or of an assistant nobody knows, is recorded.
 *
 * ```ts
 * import { equal } from '@yaks/testing'
 * let row = (agent: string) => ({ entity: { eid: agent }, lapsed: { agent } })
 * equal(owed('claude', [], []), true)
 * equal(owed('claude', ['claude'], []), false)
 * equal(owed('claude', [], [row('claude')]), false)
 * equal(owed('claude', [], [row('any')]), false)
 * equal(owed('claude', ['chatgpt'], [row('chatgpt')]), true)
 * ```
 */
export let owed = (agent: string, held: string[], rows: Bundle[]) =>
  !held.includes(agent) &&
  !rows.some((r) => agentIn(r) == agent || agentIn(r) == ANY)

/**
 * The person whose sign-in a refused refresh named, and the client that
 * asked, or nothing.
 *
 * ```ts
 * import { equal } from '@yaks/testing'
 * let p = '3b4c249e-5dba-4e24-85f6-318194d57d7d'
 * let form = (token: string) =>
 *   new URLSearchParams({ grant_type: 'refresh_token', refresh_token: token })
 * equal(unheld(form(`${p}:g:s`), 'c', 'invalid_grant'), { person: p, client: 'c' })
 * equal(unheld(form(`${p}:g:s`), 'c', 'invalid_request'), undefined)
 * equal(unheld(form('nobody&.x:g:s'), 'c', 'invalid_grant'), undefined)
 * ```
 */
export let unheld = (
  form: URLSearchParams,
  client: string,
  error: unknown,
) => {
  if (form.get('grant_type') != 'refresh_token') return
  if (error != 'invalid_grant') return
  let [person, grant, secret] = (form.get('refresh_token') ?? '').split(':')
  return EID.test(person) && grant && secret && client
    ? { person, client }
    : undefined
}

/**
 * The token door's half: a refresh refused for a sign-in its person no
 * longer holds is recorded, which owes them the letter.
 */
export let lapse = async (
  oauth: Clients,
  store: Rows,
  person: string,
  client: string,
) => {
  let agent = await agentOf(oauth, client)
  if (!agent) return
  let [held, rows, known] = await Promise.all([
    agentsOf(oauth, person),
    rowsOf(store, person),
    store.query(`.entity.eid=${person}&.email`),
  ])
  if (!known.length || !owed(agent.id, held.map((a) => a.id), rows)) return
  await store.apply([{
    entity: { eid: '$lapse' },
    lapsed: { person, agent: agent.id },
  }], KERNEL)
}

/**
 * The token door's reading of a refresh the provider refused (`res`, its
 * answer to `form` from `client`): one refused because the sign-in it names
 * is gone is a lapse ({@link lapse}); anything else is nobody's news.
 */
export let refusedRefresh = async (
  oauth: Clients,
  store: Rows,
  form: URLSearchParams,
  client: string,
  res: Response,
) => {
  let said: unknown = await res.json().catch(() => null)
  let error = said && typeof said == 'object' && 'error' in said
    ? said.error
    : undefined
  let named = unheld(form, client, error)
  if (named) await lapse(oauth, store, named.person, named.client)
}

/**
 * Connecting an assistant again ends its lapse, and the lapse of an
 * assistant nobody knew, so the next one is news again.
 */
export let reconnected = async (
  oauth: Clients,
  store: Rows,
  person: string,
  client: string,
) => {
  let agent = await agentOf(oauth, client)
  if (!agent) return
  let gone = (await rowsOf(store, person))
    .filter((r) => agentIn(r) == agent.id || agentIn(r) == ANY)
  if (!gone.length) return
  await store.apply(
    gone.map((r) => ({ entity: { eid: r.entity.eid }, $delete: true })),
    KERNEL,
  )
}

/** A person who disconnects an assistant knows it is gone: nothing is sent. */
export let closed = (store: Rows, person: string, agent: string) =>
  store.apply([{
    entity: { eid: '$lapse' },
    lapsed: { person, agent, known: new Date().toISOString() },
  }], KERNEL)

// How each assistant connects again, as the person sees it. Each step is a
// paragraph of its own, since the letter's HTML runs a paragraph's lines
// together (mail.ts `sending`).
let STEPS: Record<string, { name: string; steps: string[] }> = {
  claude: {
    name: 'Claude',
    steps: [
      "Open Claude's connectors: https://claude.ai/customize/connectors",
      'Find yaks.app and press Connect.',
      'Sign in with this email address when it asks.',
    ],
  },
  chatgpt: {
    name: 'ChatGPT',
    steps: [
      "Open ChatGPT's plugins on the web: https://chatgpt.com/plugins",
      'Choose yaks.app and connect it.',
      'Sign in with this email address when it asks.',
    ],
  },
  'claude-code': {
    name: 'Claude Code',
    steps: [
      'Start Claude Code, run /mcp and pick yaks.',
      'Choose Authenticate, and sign in with this email address in the ' +
      'browser it opens.',
    ],
  },
  cursor: {
    name: 'Cursor',
    steps: [
      'Open Cursor Settings, then Tools & Integrations.',
      'Click yaks and sign in with this email address.',
    ],
  },
}

let numbered = (steps: string[]) =>
  steps.map((s, i) => `${i + 1}. ${s}`).join('\n\n')

/**
 * The letter: what happened, that nothing is lost, and the steps for the
 * assistant that lost its sign-in, or for Claude and ChatGPT both when
 * nobody knows which it was.
 *
 * ```ts
 * import { ok } from '@yaks/testing'
 * ok(letter('chatgpt').subject.includes('ChatGPT'))
 * let any = letter('any').body
 * ok(any.includes('Claude') && any.includes('ChatGPT'))
 * ```
 */
export let letter = (agent: string, env: Host = {}) => {
  let known = STEPS[agent]
  let name = known?.name ?? 'your assistant'
  let again = `If yaks.app isn't there any more, these steps add it again: ${
    url(env, managePath('connect'))
  }`
  let steps = known
    ? `To connect ${name} again:\n\n${numbered(known.steps)}`
    : agent != ANY
    ? 'To connect it again, open its settings for connectors, find ' +
      'yaks.app, and sign in with this email address.'
    : [STEPS.claude, STEPS.chatgpt].map((s) =>
      `If you use ${s.name}:\n\n${numbered(s.steps)}`
    ).join('\n\n')
  return {
    subject: `Reconnect ${known ? name : 'your assistant'} to yaks.app`,
    body: `${known ? name : 'Your assistant'} can't reach yaks.app right ` +
      `now: its sign-in to yaks.app has ended. Everything you made is still ` +
      `there, just as you left it.\n\n${steps}\n\n${again}`,
  }
}
