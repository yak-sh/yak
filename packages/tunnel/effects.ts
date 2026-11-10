// The effects facet, exported as `@yaks/tunnel/effects`: what the machine
// says back up its tunnel. A session standing here for a conversation held on
// the tunnel's platform (@yaks/session `standIn`, at ./routes.ts `DOOR`) has
// no process to hear a knock with, so a knock at it is news for that
// conversation: `tunnel_tell` gives its words to the platform, as the
// machine's person through their own connection to it, naming the
// conversation and the knock, and marks the knock said. yaks.app takes it in
// as a request on the Operator's `machine` channel (workers/yak/tunnel.ts),
// and its Operator decides whether its person hears of it. The knock names
// the request, so a run tried again tells it once.

import type { Handlers } from '@yaks/effects'
import type { Bundle, Comp, Eid, Graph } from '@yaks/graph'
import type { Vault } from '@yaks/secrets'
import { accountCredential } from '@yaks/connections'
import { DOOR } from './routes.ts'

/** What a config file can set for this facet, beside ./routes.ts's own. */
export type Options = {
  /** the platform the tunnel's conversations are held on */
  platform?: string
  /** which of the person's connections to it to speak as (its account) */
  as?: string
}

/** What a knock tells the platform: the conversation it is news for, the
 * knock that names it, its words, and what it tells of, where it names one
 * entity here (`knock{about}`), so an alert about it opens at its row. */
export type Told = { conversation: string; key: Eid; text: string; about?: Eid }

/** Telling the platform one thing. */
export type Tell = (told: Told) => Promise<void>

/** What this facet reads off the host: the graph, the vault the person's
 * connection is kept in, and the person the config names. */
export type Hosting = {
  graph: Pick<Graph, 'get' | 'apply' | 'read' | 'address'>
  vault: Vault
  config?: { person?: string }
}

/** The platform a tunnel's conversations are held on, unless the config says
 * another. */
export let PLATFORM = 'https://yaks.app'

/** Where the platform hears its machine. */
export let TELL = '/api/tunnel'

let comp = (b: Bundle | undefined, name: string): Comp =>
  (b?.[name] ?? {}) as Comp
let str = (v: unknown): string => typeof v == 'string' ? v : ''

/** What the knock `eid` tells the platform, or nothing where it is said
 * already or is not at a session standing at this door for a conversation. */
export let telling = async (
  g: Pick<Graph, 'get'>,
  eid: Eid,
): Promise<Told | undefined> => {
  let [knock] = await g.get([eid], ['knock', 'doc', 'notified'])
  if (!knock?.knock || knock.notified) return
  let [at] = await g.get([str(comp(knock, 'knock').target)], ['session'])
  let session = comp(at, 'session')
  let conversation = str(session.source)
  if (session.door != DOOR || !conversation) return
  let about = str(comp(knock, 'knock').about)
  return {
    conversation,
    key: eid,
    text: str(comp(knock, 'doc').body),
    ...about ? { about } : {},
  }
}

/** Tell the platform what the knock `eid` says, and mark it said. */
export let tellOf = async (
  g: Pick<Graph, 'get' | 'apply'>,
  tell: Tell,
  eid: Eid,
): Promise<void> => {
  let told = await telling(g, eid)
  if (!told) return
  await tell(told)
  await g.apply([{ entity: { eid }, notified: {} }], { trusted: true })
}

/** Telling the platform at `options.platform` as the config's person, through
 * their connection to it. */
export let platformTell = (
  host: Hosting,
  options: Options = {},
  fetching: typeof fetch = fetch,
): Tell =>
async (told) => {
  let origin = new URL(options.platform ?? PLATFORM)
  let said = host.config?.person
  if (!said) throw new Error('the tunnel tells its platform as nobody')
  let owner = ((await host.graph.address([said])).get(said) ?? said) as Eid
  let integration = origin.hostname == 'yaks.app' ? 'yaks.app' : origin.origin
  let at = await accountCredential(host, owner, integration, options.as)
  if (!at) throw new Error(`no ${integration} connection to tell it through`)
  let r = await fetching(new URL(TELL, origin), {
    method: 'POST',
    headers: { authorization: `Bearer ${at.bearer}` },
    body: new URLSearchParams(
      { do: 'tell', ...told } as Record<string, string>,
    ),
  })
  if (r.ok) return void await r.body?.cancel()
  let body = await r.text()
  throw new Error(`${origin.host} said ${r.status} to a knock: ${body}`)
}

/** The effect behind `tunnel_tell`. */
export let effects = (host: Hosting, options: Options = {}): Handlers => ({
  tunnel_tell: (e) =>
    tellOf(host.graph, platformTell(host, options), e.entity.eid),
})
