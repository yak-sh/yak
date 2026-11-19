// A stranger at a private published app (D-134327), as yaks.app's Worker
// serves one. Who is served which store, when a visit becomes a store of
// one's own and what the directory keeps of it are @yaks/platform/visits';
// this is what the Worker lends them: the directory (`ledgerOf`), the copy a
// birth makes of the sample's Durable Object, the cookies a browser is told
// its stores in, and the published release a stranger is served.
//
// The door (apps.ts) asks `visiting` right after it knows who is asking, and
// a birth (`born`) is bounded there: a source makes at most BIRTH_RATE stores
// a minute, and an app's strangers hold at most `CAP`. Visitor data remains
// recoverable until its owner confirms a purge (erase.ts `unvisited`). The app's own
// schedule runs in each store as it does in the app's, and stops with it.
//
// Installing with `visit` (tools.ts app_install) makes the store an app of the
// installer's own (@yaks/platform/visits `adopt`).
import { type Line } from '@yaks/query'
import {
  claim,
  holder,
  holding,
  type Ledger,
  settled,
  storeCookie,
  type Visit,
  visitAt,
} from '@yaks/platform/visits'
import { type App, type Directory, type Space, storeName } from './directory.ts'
import { storeOf } from './door.ts'
import type { Env } from './env.ts'
import type { Host } from '@yaks/platform/host'
import { instrumentEid } from '@yaks/platform/instrument'
import { KERNEL, meta } from './meta.ts'
import { COPY } from './relocate.ts'
import { cleared } from './sample.ts'
import { domainOf, newcomer, SESSION } from './session.ts'
import { background } from './defects.ts'
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

// The births under way in this isolate, by app and browser: a page that sends
// two writes at once makes one store.
let births = new Map<string, Promise<Visit>>()

/**
 * A store of this browser's own, copied from the app's sample at one instant,
 * then written on its edge (@yaks/platform/visits `settled`). Answers the
 * store the edge holds, which is another birth's where one won the race; the
 * loser's copy is emptied. A browser someone is signed in on is theirs before
 * the copy is made (`claim`, the way attribution.ts `claimed` writes it at
 * sign-in), so what they make there is claimed from its first write, and no
 * sweep takes it for nobody's.
 */
export let born = (
  env: Env,
  space: Space,
  app: App,
  via: string,
  by: string | null,
  now = new Date(),
): Promise<Visit> => {
  let key = `${app.eid} ${instrumentEid(via)}`
  let held = births.get(key)
  if (held) return held
  let birth = bear(env, space, app, via, by, now)
    .finally(() => births.delete(key))
  births.set(key, birth)
  // Another request may await this birth: held to its end (lib/shared.ts).
  background(birth.then(() => {}, () => {}))
  return birth
}

let bear = async (
  env: Env,
  space: Space,
  app: App,
  via: string,
  by: string | null,
  now: Date,
): Promise<Visit> => {
  let l = ledgerOf(env)
  if (by) await claim(l, via, by)
  let visit: Visit = {
    ...visitAt(storeName(space, app), crypto.randomUUID()),
    seen: now.toISOString(),
    adopted: null,
  }
  let copy = await storeOf(env.STORE, app.demo!.store)(
    `${COPY}?to=${encodeURIComponent(visit.store)}`,
    { method: 'POST' },
    KERNEL,
  )
  if (!copy.ok) throw new Error(`visit copy: ${await copy.text()}`)
  await copy.body?.cancel()
  let kept = await settled(l, via, app.eid, visit)
  if (kept.store != visit.store) await cleared(env, visit.store)
  return kept
}

/** One release of the app, by its version, read once per isolate: a release
 * never changes. */
let releases = new Map<string, Promise<Release | null>>()
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
