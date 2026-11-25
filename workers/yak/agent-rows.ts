// The agents a person connected (@yaks/platform/agents), which no store
// holds: read from their OAuth grants (connected.ts `agentsOf`) by the page
// graph's door (reach-door.ts) as a page asks, again each time the
// directory says their grants moved (grant-rows.ts, side.ts), and by a page itself
// for its first paint (manage.ts). A read that fails is reported and answered
// with no rows, so what depends on the agents stays unsettled. A press of
// Disconnect is done here as the person.
import type { Bundle } from '@yaks/graph'
import { agentsRow } from '@yaks/platform/agents'
import { caught } from './defects.ts'
import type { Directory } from './directory.ts'
import type { Env } from './env.ts'

// The identity part, asked for at request time: it carries the OAuth
// provider, whose `cloudflare:` modules exist only inside workerd
// (manage.ts `identity`).
let identity = () => import('./identity.ts')

/** The agents `person` connected, as their row. */
export let agentsIn = async (
  env: Env,
  dir: Directory,
  person: string,
): Promise<Bundle[]> => {
  try {
    return [
      agentsRow(person, await (await identity()).agents(env, person, dir)),
    ]
  } catch (e) {
    caught(e, { request: 'read agents' })
    return []
  }
}

/** Disconnect the agent `agent` of `person`, pressed as `press`: every grant
 * it stands for revoked. Answers the press with what it came to, and the
 * person's agents read again. */
export let disconnected = async (
  env: Env,
  dir: Directory,
  person: string,
  press: Bundle,
  agent: string,
): Promise<Bundle[]> => {
  await (await identity()).disconnectAgent(env, person, agent, dir)
  return [
    { ...press, disconnectAgent: { agent, said: 'Disconnected.' } },
    ...await agentsIn(env, dir, person),
  ]
}
