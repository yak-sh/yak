// The person's own Operator as chief of staff over their other spaces'
// Operators (T-2226). From the space that is theirs (`member.own`, the PA of
// operator-reach.ts), `operator_spaces` asks each space they own for what its
// Operator is doing for them: the newest of its conversation with them, the
// work it has going, what waits on them in its Updates, the handoffs it is
// waiting on, and what it spent. Each space answers from its own store at the
// handoff door (operator-handoff.ts `door`), as the same person there, so what
// they said to that Operator directly is seen here too. Handing work to one
// and following it up is session_send (operator-send.ts); each space's Operator still answers
// its own people directly.
import { line } from '@yaks/query'
import type { Tool } from '@yaks/session'
import { directoryOf, type Space } from './directory.ts'
import type { Env } from './env.ts'
import { recentOf, updatesText, workingOf } from './operator-glance.ts'
import { door, waiting } from './operator-handoff.ts'
import type { OperatorStore } from './operator-store.ts'
import type { Reach } from './directory.ts'
import { refuse } from './tool.ts'

/** What one space's Operator is doing for a person, as its space tells it. */
export type Overview = {
  space: string
  said: string
  work: string
  updates: string
  handoffs: { session: string; space?: string; say?: string; at?: string }[]
  /** dollars its Operator spent over the last thirty days, everyone's */
  spent: number
}

// How far back a space's spend is counted, in days.
let DAYS = 30

/** What this space's Operator is doing for `person`, read from its store. */
export let overviewOf = async (
  env: Env,
  store: OperatorStore,
  space: string,
  person: string,
): Promise<Omit<Overview, 'space'>> => {
  let g = { store, space, person, dir: directoryOf(env.STORE) }
  let since = new Date(Date.now() - DAYS * 86_400_000).toISOString()
  let [said, work, updates, handoffs, asks] = await Promise.all([
    recentOf(g, 4),
    workingOf(g, 4),
    updatesText(g, 4),
    waiting(store, person),
    store.g.read(line`.ask&.created.at>=${since}&.fields=cost.dollars`),
  ])
  let spent = asks.reduce(
    (sum, a) => sum + Number((a.cost as { dollars?: number })?.dollars ?? 0),
    0,
  )
  return {
    said: said || 'They have not talked with it.',
    work,
    updates,
    handoffs,
    spent: Math.round(spent * 100) / 100,
  }
}

/** A space answers for a person who owns it, asked from another space they
 * write in. */
export let acceptOverview = async (
  env: Env,
  store: OperatorStore,
  space: string,
  asked: { person: string; from: string },
) => {
  let dir = directoryOf(env.STORE)
  let [from, to] = await Promise.all([dir.at(asked.from), dir.at(space)])
  if (
    !from || from.trashed || !to || to.trashed || from.eid == to.eid ||
    await dir.role(to, asked.person) != 'owner' ||
    await dir.role(from, asked.person) != 'owner'
  ) throw refuse('access', 'This overview requires owning both spaces.')
  return overviewOf(env, store, space, asked.person)
}

export let spacesTool = (
  env: Env,
  from: Space,
  person: string,
  beyond: Reach[],
): Tool => ({
  name: 'operator_spaces',
  title: 'See what the Operators of your other spaces are doing',
  step: {
    doing: 'Looking across your spaces…',
    done: 'Looked across your spaces',
  },
  description:
    'For each other space the person owns, or the ones named: the newest of what they said with its Operator, the work it has going, what waits on them in its Updates, the handoffs it is waiting on, and what it spent in the last 30 days. Use it when they ask how their spaces are doing, before handing work to one, and to check on work you handed off.',
  readOnly: true,
  parameters: {
    type: 'object',
    properties: {
      spaces: {
        type: 'array',
        items: { type: 'string' },
        description: 'Space slugs to look at; all of them when left out.',
      },
    },
  },
  run: async ({ spaces }) => {
    let named = Array.isArray(spaces) ? spaces.map(String) : []
    let owned = beyond.filter((r) =>
      r.role == 'owner' &&
      (!named.length || named.includes(r.space.slug))
    )
    if (!owned.length) {
      throw refuse('missing', 'They own no other space by that name.')
    }
    let looked = await Promise.all(owned.map(async ({ space }) => {
      try {
        let told = await door(env, space.eid, 'overview', {
          person,
          from: from.eid,
        }) as Omit<Overview, 'space'>
        return { space: space.slug, ...told }
      } catch (error) {
        return { space: space.slug, error: (error as Error).message }
      }
    }))
    return JSON.stringify(looked)
  },
})
