// A stranger at a private published app (D-134327), as yaks.app's Worker
// serves one. Who is served which store, when a visit becomes a store of
// one's own and what the directory keeps of it are @yaks/platform/visits';
// this is what the Worker lends them: the directory (`ledgerOf`), the cookies
// a browser is told its stores in, and the published release a stranger is
// served.
//
// The door (apps.ts) asks `visiting` right after it knows who is asking, and
// a birth (visit-birth.ts) is bounded there: a source makes at most BIRTH_RATE stores
// a minute, and an app's strangers hold at most `CAP`. Visitor data remains
// recoverable until its owner confirms a purge (erase.ts `unvisited`). The app's own
// schedule runs in each store as it does in the app's, and stops with it.
//
// Installing with `visit` (tools.ts app_install) makes the store an app of the
// installer's own (@yaks/platform/visits `adopt`).
import { type Line } from '@yaks/query'
import {
  holder,
  holding,
  type Ledger,
  storeCookie,
  type Visit,
} from '@yaks/platform/visits'
import type { App, Directory } from './directory.ts'
import type { Env } from './env.ts'
import type { Host } from '@yaks/platform/host'
import { KERNEL, meta } from './meta.ts'
import { domainOf, newcomer, SESSION } from './session.ts'
import { sharing } from './lib/shared.ts'
import { offered } from '@yaks/platform/installs'

/** The directory as @yaks/platform/visits reads and writes it: every write
 * the kernel's own. */
export let ledgerOf = (env: Pick<Env, 'STORE'>): Ledger => ({
  query: (line) => meta(env).query(line as Line),
  apply: (bundles) => meta(env).apply(bundles, KERNEL),
})

/** What a stranger is served of a published release that is no longer the
 * app's live one: its files, its worker and its words. */
export type Release = Pick<
  App,
  'version' | 'source' | 'script' | 'worker' | 'lenses'
>

// What each answer has to tell its browser, by the request it answers.
let telling = new WeakMap<Request, { via: string; names: string[] }>()
let tell = (req: Request, via: string, names: string[]) => {
  if (!names.length) return
  let held = telling.get(req)
  telling.set(req, { via, names: [...held?.names ?? [], ...names] })
}

/**
 * This browser's own store of the app (@yaks/platform/visits `holding`), its
 * cookies read and what they are to say remembered for its answer. `req` is
 * the request as the browser sent it: its cookies are what it says.
 */
export let ownOf = async (
  env: Pick<Env, 'STORE'>,
  req: Request,
  via: string,
  app: string,
): Promise<Visit | null> => {
  let { visit, tell: names } = await holding(
    ledgerOf(env),
    {
      cookie: req.headers.get('cookie'),
      newcomer: newcomer(req, via),
    },
    via,
    app,
  )
  tell(req, via, names)
  return visit
}

/** The store just made for this browser, told to it on the answer. */
export let tellBorn = (req: Request, via: string, app: string) =>
  tell(req, via, [storeCookie(app)])

/** The answer to `req`, carrying the cookies it has to tell its browser. */
export let toldStores = (req: Request, res: Response, env: Host): Response => {
  let said = telling.get(req)
  if (!said || res.status == 101) return res
  let me = holder(said.via), domain = domainOf(req, env)
  let out = new Response(res.body, res)
  for (let name of said.names) {
    out.headers.append(
      'set-cookie',
      `${name}=${me}; ${domain ? `Domain=${domain}; ` : ''}` +
        `Path=/; Max-Age=${SESSION}; Secure; HttpOnly; SameSite=Lax`,
    )
  }
  return out
}

/** One release of the app, by its version, read once per isolate: a release
 * never changes. */
let releases = new Map<string, Release | null>()
export let releaseAt = (
  dir: Pick<Directory, 'deployAt'>,
  app: App,
  version: number,
): Promise<Release | null> =>
  sharing(
    releases,
    `${app.eid} ${version}`,
    () =>
      dir.deployAt(app, version).then((d) =>
        d
          ? {
            version: d.version,
            source: d.source,
            script: d.script,
            worker: d.worker,
            lenses: d.lenses,
          }
          : null
      ),
    256,
  )

/** The source of the release the app offers, whose files anyone may have
 * (@yaks/platform/installs `offered`): the published version's. Null for an
 * app that offers none. */
export let offeredSource = async (
  dir: Pick<Directory, 'deployAt'>,
  app: App,
): Promise<string | null> => {
  if (!offered(app)) return null
  let version = app.published!.version
  if (version == app.version) return app.source ?? null
  return (await releaseAt(dir, app, version))?.source ?? null
}

/** The published release a stranger is served when the app has moved past
 * it. */
export let releaseFor = (
  dir: Pick<Directory, 'deployAt'>,
  app: App,
): Promise<Release | null> => {
  let version = app.demo?.version
  return version == null || version == app.version
    ? Promise.resolve(null)
    : releaseAt(dir, app, version)
}
