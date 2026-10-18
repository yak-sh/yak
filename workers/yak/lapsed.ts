// An assistant that lost its sign-in to yaks.app is our bug, reported to the
// tracker (T-127811, M-37923, M-37965), never a letter to its person.
//
// The token door sees the moment: a refresh it refuses, the assistant coming
// back with a refresh token, `<person>:<grant>:<secret>`, for a grant that is
// gone. When the person holds no other sign-in for that assistant, the door
// records a `lapsed{person, agent}` row in the directory and reports the
// lapse, so its cause gets fixed.
//
// The row is the once. Its eid is derived from the person and the assistant,
// so every later refusal lands on the same row and reports nothing, until the
// person connects that assistant again and the row goes (`reconnected`). A row
// whose `agent` is `any` stands for every assistant, so its person is not
// reported again by the door. A person who disconnects an assistant
// themselves is no bug (`closed`).
//
// A refresh token is a string anybody can make up, so the person it names is
// only believed as far as the rule allows: one report per assistant until the
// person connects it again, and only for a person the directory knows.
import type { Bundle } from '@yaks/graph'
import { agentOf, agentsOf, type Clients } from './connected.ts'
import { KERNEL, type Meta } from './meta.ts'
import { caught } from './defects.ts'

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

/** A sign-in the person held is gone, found when its assistant came back. */
export class LapsedSignIn extends Error {
  override name = 'LapsedSignIn'
  constructor(agent: string) {
    super(`A refresh was refused for a grant that is gone: ${agent}`)
  }
}

/**
 * The token door's half: a refresh refused for a sign-in its person no
 * longer holds is recorded and reported to the tracker, once.
 */
export let lapse = async (
  oauth: Clients,
  store: Rows,
  person: string,
  client: string,
  report: typeof caught = caught,
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
  report(new LapsedSignIn(agent.id), {
    request: 'POST /oauth/token',
    person,
    agent: agent.id,
    held: held.map((a) => a.id).join(' ') || 'none',
  })
}

/**
 * The token door's reading of a refresh the provider refused (`res`, its
 * answer to `form` from `client`): one refused because the sign-in it names
 * is gone is a lapse ({@link lapse}); anything else is not.
 */
export let refusedRefresh = async (
  oauth: Clients,
  store: Rows,
  form: URLSearchParams,
  client: string,
  res: Response,
  report?: typeof caught,
) => {
  let said: unknown = await res.json().catch(() => null)
  let error = said && typeof said == 'object' && 'error' in said
    ? said.error
    : undefined
  let named = unheld(form, client, error)
  if (named) await lapse(oauth, store, named.person, named.client, report)
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

/** A person who disconnects an assistant knows it is gone: no bug. */
export let closed = (store: Rows, person: string, agent: string) =>
  store.apply([{
    entity: { eid: '$lapse' },
    lapsed: { person, agent, known: new Date().toISOString() },
  }], KERNEL)
