import { identityEid } from '@yaks/graph/identity'
import { instrumentEid } from '@yaks/platform/instrument'
import { directory } from './directory.ts'
import * as dirPart from './directory.ts'
import { bound, type Env } from './env.ts'
import type { Claims } from './lib/token.ts'
import type { Bundle } from '@yaks/graph'

export type BrowserSession = {
  eid: string
  person: string
  via: string
  until: string
  agent: string
}

export let sessions = (env: Env) =>
  directory(bound(env.DIRECTORY, dirPart.fetch, env))

/** Old cookies and page tokens find the same session before they name a row. */
export let prior = (person: string, via: string) =>
  identityEid('browser_session', [person, instrumentEid(via)])

export let sessionId = (claims: Claims & { via: string }) =>
  claims.session ?? prior(claims.person, claims.via)

export let held = async (
  env: Env,
  person: string,
  via: string,
  session?: string,
) => {
  let { cancelled, ended, session: kept } = await sessions(env).browserSession(
    session ?? prior(person, via),
    person,
  )
  if (cancelled || !session && ended) return false
  return kept
    ? kept.person == person && Date.parse(String(kept.until)) > Date.now()
    : !session
}

export let keep = async (
  env: Env,
  req: Request,
  claims: Claims & { via: string; session: string },
) => {
  await sessions(env).stamp({
    entities: [{
      entity: { eid: claims.session },
      browser_session: {
        person: claims.person,
        via: instrumentEid(claims.via),
        until: new Date(claims.exp * 1000).toISOString(),
        agent: (req.headers.get('user-agent') ?? 'Browser').slice(0, 300),
      },
    }],
  })
}

/** Keep the cancellation until every pre-migration copy could have expired. */
let ending = (session: BrowserSession): Bundle[] => {
  let ids = new Set([session.eid, prior(session.person, session.via)])
  return [...ids].map((eid) => ({
    entity: { eid },
    browser_session: {
      person: session.person,
      via: session.via,
      until: session.until,
      agent: session.agent,
    },
    cancelled: {},
  }))
}

export let end = (env: Env, session: BrowserSession) =>
  sessions(env).stamp({ entities: ending(session) })

export let browsers = (env: Env, person: string) =>
  sessions(env).browserSessions(person)

export let endAll = async (env: Env, person: string) => {
  let all = await browsers(env, person)
  await sessions(env).stamp({
    entities: [
      { entity: { eid: person }, sessions_ended: {} },
      ...all.flatMap(ending),
    ],
  })
}
