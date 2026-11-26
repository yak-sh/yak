import { identityEid } from '@yaks/graph/identity'
import { instrumentEid } from '@yaks/platform/instrument'
import { placeOf, type Whereabouts } from '@yaks/platform/signed-in'
import { type Directory, directory } from './directory.ts'
import { copyOf } from './directory-copy.ts'
import * as dirPart from './directory.ts'
import { bound, type Env } from './env.ts'
import type { Claims } from './lib/token.ts'
import type { Bundle } from '@yaks/graph'
import { background, caught } from './defects.ts'

export type BrowserSession = {
  eid: string
  person: string
  via: string
  until: string
  agent: string
  /** Where its network placed it, when it said. */
  place?: string
  /** When it signed in. */
  at?: string
}
export type SessionSeed = Omit<BrowserSession, 'person' | 'at'>

/** What a request says of the browser that sent it. */
export let seen = (req: Request & { cf?: Whereabouts }) => ({
  agent: (req.headers.get('user-agent') ?? 'Browser').slice(0, 300),
  place: placeOf(req.cf ?? {}),
})

export let sessionRow = (seed: SessionSeed, person: string): Bundle => ({
  entity: { eid: seed.eid },
  browser_session: {
    person,
    via: instrumentEid(seed.via),
    until: seed.until,
    agent: seed.agent,
    ...seed.place ? { place: seed.place } : {},
  },
})

export let sessions = (env: Env) =>
  directory(bound(env.DIRECTORY, dirPart.fetch, env), {
    copy: copyOf(env),
    time: env.CLOCK,
  })

/** Old cookies and page tokens find the same session before they name a row. */
export let prior = (person: string, via: string) =>
  identityEid('browser_session', [person, instrumentEid(via)])

export let sessionId = (claims: Claims & { via: string }) =>
  claims.session ?? prior(claims.person, claims.via)

/** Why a browser's session is not `person`'s now, as the directory says
 * it, or null while it is. */
export let unheld = async (
  env: Env,
  person: string,
  via: string,
  session?: string,
  dir: Directory = sessions(env),
): Promise<string | null> => {
  let { cancelled, ended, present, session: kept } = await dir
    .browserSession(
      session ?? prior(person, via),
      person,
    )
  return !present
    ? 'the directory has no such person'
    : cancelled
    ? 'it was signed out'
    : !session && ended
    ? 'its person signed out everywhere'
    : !kept
    ? session ? 'the directory has no row for it' : null
    : kept.person != person
    ? 'its row names someone else'
    : Date.parse(String(kept.until)) <= Date.now()
    ? `it ended at ${kept.until}`
    : null
}

export let held = async (
  env: Env,
  person: string,
  via: string,
  session?: string,
  dir?: Directory,
) => !await unheld(env, person, via, session, dir)

export let keep = async (
  env: Env,
  req: Request,
  claims: Claims & { via: string; session: string },
) => {
  // Where their connection places them as they sign in (located.ts).
  background(
    import('./located.ts').then(({ connected }) =>
      connected(env, claims.person, req)
    ).catch((e) => caught(e, { request: 'sign-in located' })),
  )
  await sessions(env).stamp({
    entities: [
      sessionRow({
        eid: claims.session,
        via: claims.via,
        until: new Date(claims.exp * 1000).toISOString(),
        ...seen(req),
      }, claims.person),
    ],
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

/** Cancel every held browser and all rowless legacy copies in one write. */
export let ended = (person: string, all: BrowserSession[]): Bundle[] => [
  { entity: { eid: person }, sessions_ended: {} },
  ...all.flatMap(ending),
]

export let endAll = async (env: Env, person: string) => {
  await sessions(env).stamp({
    entities: ended(person, await browsers(env, person)),
  })
}
