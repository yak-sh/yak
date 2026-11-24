// The page graph's door (D-475). A signed-in tab keeps one @yaks/client
// (@yaks/client `shared`), and this is its server: @yaks/api's `/query`,
// `/apply` and `/ws` under REACH, answered across every store the person
// reaches (reach.ts), as the browser's own session. A read is the reach's one
// answer, a write is the agent door's (agent.ts `reachWrite`, `$app` and all),
// and a watch is the reach's live watch, each subscription on the tab's one
// socket.
//
// The person's side (@yaks/platform/side-rows) and their Updates badges are
// reads of the person the directory answers, live on its `/person/ws`.
//
// One write is not rows: an Updates card's action (updates.ts `acting`) is
// done here and answered with its receipt, the way the card's page graph
// shows it at once and the server confirms it.
import { attach } from '@yaks/api'
import type { Bundle } from '@yaks/graph'
import { type Kept, watched } from '@yaks/api/reached'
import { refusal } from '@yaks/api/refuse'
import { status } from '@yaks/graph/errors'
import { doorOf, IDEMPOTENCY } from '@yaks/durable-object/door'
import {
  UPDATE_WAITING,
  waitingFrom,
  watchWaiting,
} from '@yaks/platform/update-waiting'
import { PLATFORM_STORE } from '@yaks/platform/names'
import { sideLine } from '@yaks/platform/side-rows'
import { sideRows } from './side.ts'
import { REACH, TAB_PERSON } from '@yaks/platform/routes'
import { whole } from '@yaks/query'
import { CallError, refused as toolRefused } from '@yaks/tools/errors'
import { workerUpgrade } from '@yaks/workerd'
import { inReach } from './declared.ts'
import { builderOf, operatorDoor, SPACE } from './build-door.ts'
import { caught } from './defects.ts'
import type { Directory } from './directory.ts'
import { storeOf } from './door.ts'
import type { Env } from './env.ts'
import { upgrading } from './protocol.ts'
import { KERNEL, meta } from './meta.ts'
import { type Reach, read, watch, watching } from './reach.ts'
import { reachWrite } from './agent.ts'
import { vouched, type Who } from './session.ts'
import type { Clock } from './timing.ts'
import { acting, updatesApply, waitingSeats } from './updates.ts'

let TAGS = { request: 'reach door' }

// A refusal as @yaks/api says one, at its status; a failure is reported and
// said as 503, which the page's sync tries again.
let refused = (e: unknown): Response => {
  if (e instanceof CallError) {
    return Response.json({ error: e.code, message: e.message }, {
      status: toolRefused(e).status,
    })
  }
  let code = (e as { status?: number } | null)?.status ?? status(e)
  if (code >= 400 && code < 500) {
    return Response.json(refusal(e), { status: code })
  }
  caught(e, TAGS)
  return new Response(null, { status: 503 })
}

/** The page graph's door for `who`, signed in with the browser's session. */
export let reachDoor = async (
  req: Request,
  env: Env,
  dir: Directory,
  who: Who,
  c: Clock,
): Promise<Response> => {
  let url = new URL(req.url)
  let door = url.pathname.slice(REACH.length)
  let { person } = who
  // A tab drawn for someone else than the browser is now signed in as.
  let tab = req.headers.get(TAB_PERSON) ?? url.searchParams.get(TAB_PERSON)
  if (!person || (tab && tab != person)) {
    return Response.json(
      { error: 'Unauthorized', message: 'Sign in again.' },
      { status: 401 },
    )
  }
  let caller = { env, dir, person }
  let reach = async (): Promise<Reach[]> =>
    (await inReach(caller)).map((r) => ({
      ...r,
      who: { ...r.who, ...who.via ? { via: who.via } : {} },
    }))
  try {
    if (door == '/query' && req.method == 'GET') {
      let q = new URL(req.url).searchParams
      let line = q.get('q') ?? ''
      if (sideLine(line)) {
        return Response.json(await sideRows(dir, person, line))
      }
      if (line == UPDATE_WAITING) {
        let seats = await waitingSeats(dir, person)
        let rows = await Promise.all(
          seats.map(async ({ space, role, bundle }) => {
            try {
              let answer = await operatorDoor(
                env,
                space,
                { ...who, role },
                'updates',
                { count: true },
              ) as { waiting: number }
              waitingFrom(bundle).count += answer.waiting
              return [bundle]
            } catch (e) {
              caught(e, { request: 'Updates count', space: space.slug })
              return []
            }
          }),
        )
        return Response.json(rows.flat())
      }
      return Response.json(
        await read(
          env,
          await reach(),
          whole(line),
          q.get('live') == '1',
        ),
      )
    }
    if (door == '/apply' && req.method == 'POST') {
      let bundles = await req.json() as Bundle[]
      if (acting(bundles)) {
        return await updatesApply(bundles, env, dir, person, who.until, c)
      }
      let key = req.headers.get(IDEMPOTENCY)
      return Response.json(
        await reachWrite(
          caller,
          await reach(),
          bundles,
          false,
          key ? { [IDEMPOTENCY]: key } : {},
        ),
      )
    }
    if (door == '/ws' && upgrading(req)) {
      let stores: Promise<Reach[]> | undefined
      let { socket, response } = workerUpgrade(req)
      attach(
        watched({
          watch: (line, sink) => {
            // A read of the person the directory answers live.
            let personal = (emit: (frame: Kept) => void) =>
              watching(
                meta(env).door ?? storeOf(env.STORE, PLATFORM_STORE),
                'directory',
                line,
                emit,
                { ...vouched(who), ...KERNEL },
                '/person/ws',
              )
            if (sideLine(line)) return personal(sink)
            if (line == UPDATE_WAITING) {
              let headers = vouched(who)
              return watchWaiting(
                personal,
                (seat) => (emit) => {
                  let { space, slug } = waitingFrom(seat)
                  let ask = builderOf(env, space)
                  return watching(
                    doorOf((req) => ask(() => req)),
                    slug,
                    line,
                    emit,
                    { ...headers, [SPACE]: space },
                    '/api/waiting/ws',
                  )
                },
                sink,
              )
            }
            let closed = false
            let stop: (() => void) | undefined
            ;(stores ??= reach()).then((members) => {
              if (!closed) stop = watch(env, members, line, sink)
            }, (error) => {
              stores = undefined
              if (!closed) sink({ refused: error })
            })
            return () => {
              closed = true
              stop?.()
            }
          },
          tags: TAGS,
        }),
        socket,
      )
      return response
    }
    return Response.json(
      { error: 'NotFound', message: `No ${door} here` },
      { status: 404 },
    )
  } catch (e) {
    return refused(e)
  }
}
