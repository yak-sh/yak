// The page graph's door (D-475). A signed-in tab keeps one @yaks/client
// (@yaks/client `shared`), and this is its server: @yaks/api's `/query`,
// `/apply` and `/ws` under REACH, answered across every store the person
// reaches (reach.ts), as the browser's own session. A read is the reach's one
// answer, a write is the agent door's (agent.ts `reachWrite`, `$app` and all),
// and a watch is the reach's live watch, each subscription on the tab's one
// socket.
//
// The person's side (@yaks/platform/side-rows) and their Updates badges are
// reads of the person the directory answers, live on its `/person/ws`; their
// Updates cards and drafts in a space (@yaks/platform/update-rows,
// operator-drafts) are the space's Operator store's, live on its
// `/api/waiting/ws`, and a write of drafts goes to that store. A space's
// visits (@yaks/platform/visit-counts) are in no store: they are read from
// Cloudflare's analytics here, again each time the space's apps move.
//
// What no store holds, a space's Apps page's breaks (apps-reads.ts) and a
// domain search's offers (space-pages.ts), is read as the page asks, and a
// watch of it is answered once. The person's agents (agent-rows.ts) are read
// from their grants, and again each time the directory says those moved
// (@yaks/platform/agents `GRANTS`).
//
// A space's Settings, Domains and Trash pages (@yaks/platform/space-pages)
// are reads of its owner the directory answers too.
//
// A space's plan card, where it stands with selling and whom it is billed to
// (@yaks/platform/payment-rows) no store holds: each is read of the space and
// its payment provider (payment-reads.ts), and read again whenever the
// directory says the space's row moved. Its owner's acts on them are done
// here as them.
//
// What an app beside the chat is made of (@yaks/platform/app-canvas) is no
// store's: it is read here (canvas-read.ts), and read again as the rows it is
// read from move.
//
// Some writes are not rows: an Updates card's action (updates.ts `acting`),
// the person's own account, messages and friend asks (account-writes.ts),
// who is in a space they own (people-writes.ts), and what they change of a
// space they own (space-pages.ts), are done here and answered with what they
// came to, the way the page graph shows each at once and the server confirms
// it.
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
import { personLine } from '@yaks/platform/person-lines'
import { cardsSpace, updateRows } from '@yaks/platform/update-rows'
import { draftsSpace, operatorWrite } from '@yaks/platform/operator-drafts'
import {
  reachedWrites,
  settingsRow,
  settingsSpace,
  settingsWrite,
} from '@yaks/platform/operator-settings'
import type { Update } from '@yaks/platform/update-rows'
import {
  matchesAsked,
  matchesRow,
  pickOf,
} from '@yaks/platform/operator-matches'
import { matchesOf } from './matches.ts'
import { brokenSpace } from '@yaks/platform/space-apps'
import { brokenOf } from './apps-reads.ts'
import { AGENTS, disconnecting, GRANTS } from '@yaks/platform/agents'
import { agentsIn, disconnected } from './agent-rows.ts'
import { paymentPart, paymentWrite } from '@yaks/platform/payment-rows'
import { ownedSpace, paymentApply, paymentRead } from './payment-reads.ts'
import { makingApp } from '@yaks/platform/app-canvas'
import { making, watchMaking } from './canvas-read.ts'
import {
  actedRow,
  actOf,
  askOf,
  connectionsMoved,
  formOf,
  pageAsked,
} from '@yaks/platform/connections-page'
import { writes } from '@yaks/member'
import { personRows, visitsRows } from './side.ts'
import { countsSpace } from '@yaks/platform/visit-counts'
import { sideApps } from '@yaks/platform/side-rows'
import { offersQuery, spaceLine, spaceWrite } from '@yaks/platform/space-pages'
import { offersFor, spaceApply, spaceRows } from './space-pages.ts'
import { REACH, TAB_PERSON } from '@yaks/platform/routes'
import { whole } from '@yaks/query'
import { CallError, refused as toolRefused } from '@yaks/tools/errors'
import { workerUpgrade } from '@yaks/workerd'
import { inReach } from './declared.ts'
import { builderOf, operatorDoor, settingsAt, SPACE } from './build-door.ts'
import { checked, wearing } from './operator-persona.ts'
import { caught } from './defects.ts'
import type { Directory } from './directory.ts'
import { storeOf } from './door.ts'
import type { Env } from './env.ts'
import { upgrading } from './protocol.ts'
import { KERNEL, meta } from './meta.ts'
import { type Reach, read, rereading, watch, watching } from './reach.ts'
import { reachWrite } from './agent.ts'
import { vouched, type Who } from './session.ts'
import type { Clock } from './timing.ts'
import { acting, updatesApply, waitingSeats } from './updates.ts'
import { accountApply, accountWrites } from './account-writes.ts'
import { reachedApply } from './reached-writes.ts'
import { peopleWrites } from '@yaks/platform/people-rows'
import { peopleApply } from './people-writes.ts'
import { connecting, connectionsRow, pageOf } from './connections.ts'

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
  // The person's seat in the space a cards line asks about, when it lets
  // them write there: none, and the line is answered with nothing.
  let seatIn = async (eid: string) =>
    (await dir.seated(person)).find((s) =>
      s.space.eid == eid && !s.space.trashed && writes(s.role)
    )
  // The Operator's settings in the space of `seat`, after writing `set`
  // there, when given, as its settings page's row.
  let settingsOf = async (
    seat: NonNullable<Awaited<ReturnType<typeof seatIn>>>,
    set?: Parameters<typeof settingsAt>[3],
  ) => {
    let now = await settingsAt(
      env,
      seat.space,
      { ...who, role: seat.role },
      set,
    )
    return settingsRow(seat.space.eid, wearing(now))
  }
  // What the door reads as the page asks, once: what no store holds.
  let once = (line: string) =>
    brokenSpace(line) != undefined || offersQuery(line) != undefined
  let readOnce = async (line: string): Promise<Bundle[]> => {
    let query = offersQuery(line)
    if (query != undefined) return await offersFor(env, query)
    let seat = await seatIn(brokenSpace(line)!)
    return seat
      ? await brokenOf(env, dir, seat.space, {
        ...who,
        person,
        role: seat.role,
      })
      : []
  }
  // The person's seat in the space a Connections line asks about, when they
  // own it: the page is its owners' alone (apps.ts `manage`).
  let owning = async (eid: string) =>
    (await dir.seated(person)).find((s) =>
      s.space.eid == eid && !s.space.trashed && s.role == 'owner'
    )
  // The Connections page of the space `seat` is in, as `ask` asks it.
  let connectionsAt = async (
    seat: NonNullable<Awaited<ReturnType<typeof owning>>>,
    ask: string,
  ) => [
    await connectionsRow(
      env,
      dir,
      { ...who, person, role: seat.role },
      seat.space,
      ask,
    ),
  ]
  try {
    if (door == '/query' && req.method == 'GET') {
      let q = new URL(req.url).searchParams
      let line = q.get('q') ?? ''
      let cards = cardsSpace(line)
      if (cards != undefined) {
        let seat = await seatIn(cards)
        if (!seat) return Response.json([])
        let { updates } = await operatorDoor(
          env,
          seat.space,
          { ...who, role: seat.role },
          'updates',
          {},
        ) as { updates: Update[] }
        return Response.json(updateRows(person, cards, updates))
      }
      let counted = countsSpace(line)
      if (counted != undefined) {
        return Response.json(
          (await visitsRows(env, dir, person, counted)).counts,
        )
      }
      if (once(line)) return Response.json(await readOnce(line))
      if (line == AGENTS) return Response.json(await agentsIn(env, dir, person))
      let paid = paymentPart(line)
      if (paid && paid.part != 'allowances') {
        let space = await ownedSpace(dir, person, paid.space)
        return Response.json(
          space ? await paymentRead(env, dir, space, paid.part) : [],
        )
      }
      let app = makingApp(line)
      if (app != undefined) {
        return Response.json(await making(env, dir, who, app))
      }
      let page = pageAsked(line)
      if (page) {
        let seat = await owning(page.space)
        if (!seat) return Response.json([])
        return Response.json(await connectionsAt(seat, page.ask))
      }
      let matching = matchesAsked(line)
      if (matching) {
        let seat = await seatIn(matching.space)
        if (!seat) return Response.json([])
        let { round } = matching
        return Response.json([
          matchesRow(
            seat.space.eid,
            round,
            await matchesOf(
              env,
              seat.space,
              { ...who, role: seat.role },
              round ? { round } : {},
            ),
          ),
        ])
      }
      let named = settingsSpace(line)
      if (named != undefined) {
        let seat = await seatIn(named)
        if (!seat) return Response.json([])
        return Response.json([await settingsOf(seat)])
      }
      if (spaceLine(line)) {
        return Response.json(await spaceRows(env, dir, person, line))
      }
      if (line != UPDATE_WAITING && personLine(line)) {
        return Response.json(await personRows(dir, person, line, env))
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
      let agent = disconnecting(bundles)
      if (agent != undefined) {
        return Response.json(
          await disconnected(env, dir, person, bundles[0], agent),
        )
      }
      let drafted = operatorWrite(bundles)
      if (drafted) {
        let seat = await seatIn(drafted.space)
        if (!seat) {
          return Response.json(
            { error: 'Forbidden', message: 'You do not write in that space.' },
            { status: 403 },
          )
        }
        return await builderOf(env, drafted.space)(() =>
          new Request('https://builder/api/apply', {
            method: 'POST',
            headers: {
              ...vouched(who),
              [SPACE]: drafted.space,
              'content-type': 'application/json',
            },
            body: JSON.stringify(drafted.bundles),
          })
        )
      }
      let paying = paymentWrite(bundles)
      if (paying) {
        let space = await ownedSpace(dir, person, paying.space)
        if (!space) {
          return Response.json(
            { error: 'Forbidden', message: 'Only the space’s owner may.' },
            { status: 403 },
          )
        }
        return Response.json(
          await paymentApply(paying.act, env, req, dir, space, person),
        )
      }
      let setting = settingsWrite(bundles)
      if (setting) {
        let seat = await seatIn(setting.space)
        if (!seat) {
          return Response.json(
            { error: 'Forbidden', message: 'You do not write in that space.' },
            { status: 403 },
          )
        }
        return Response.json([await settingsOf(seat, checked(setting.set))])
      }
      // A pick on the Matches page, made as the person, answered with the
      // round as it then stands.
      let picked = pickOf(bundles)
      if (picked) {
        let seat = await seatIn(picked.space)
        if (!seat) {
          return Response.json(
            { error: 'Forbidden', message: 'You do not write in that space.' },
            { status: 403 },
          )
        }
        let { space: _, ...pick } = picked
        return Response.json([
          matchesRow(
            seat.space.eid,
            pick.round,
            await matchesOf(env, seat.space, { ...who, role: seat.role }, pick),
          ),
        ])
      }
      let space = spaceWrite(bundles)
      if (space) {
        return Response.json(
          await spaceApply(bundles, env, dir, who, person, space),
        )
      }
      let act = actOf(bundles)
      if (act) {
        let seat = await owning(act.space)
        if (!seat) {
          return Response.json(
            {
              error: 'Forbidden',
              message: 'Only this space’s owner can change its connections.',
            },
            { status: 403 },
          )
        }
        // The press, as the page's own post would make it: at the page's
        // address, so what it asks (the testing integrations it names) is
        // what a sign-in comes back to.
        let at = new URL(pageOf(env, seat.space.slug))
        at.search = new URL(act.page || '/', at).search
        let said = await connecting(
          new Request(at, { method: 'POST' }),
          env,
          seat.space,
          { ...who, role: seat.role },
          formOf(act.form),
        )
        if (said instanceof Response) {
          return Response.json([
            actedRow(act.eid, { go: said.headers.get('location') ?? at.href }),
          ])
        }
        if (said.no) throw new CallError('arguments', said.say)
        return Response.json([
          actedRow(act.eid, { say: said.say }),
          ...await connectionsAt(seat, askOf(at.searchParams)),
        ])
      }
      if (reachedWrites(bundles)) {
        return Response.json(
          await reachedApply(bundles, env, dir, who, person),
        )
      }
      if (peopleWrites(bundles)) {
        return Response.json(
          await peopleApply(bundles, env, dir, { ...who, person }),
        )
      }
      if (acting(bundles)) {
        return await updatesApply(bundles, env, dir, person, who.until, c)
      }
      if (accountWrites(bundles)) {
        return Response.json(await accountApply(bundles, env, dir, person))
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
            let personal = (emit: (frame: Kept) => void, of = line) =>
              watching(
                meta(env).door ?? storeOf(env.STORE, PLATFORM_STORE),
                'directory',
                of,
                emit,
                { ...vouched(who), ...KERNEL },
                '/person/ws',
              )
            // What no store holds of a space's payments, read again each
            // time the directory says its row moved.
            let paid = paymentPart(line)
            if (paid && paid.part != 'allowances') {
              let { part, space: eid } = paid
              let asked = 0
              return personal((frame) => {
                if (frame.refused) return sink(frame)
                let mine = ++asked
                let row = frame.bundles?.find((b) => b.paymentAccount)
                ownedSpace(dir, person, eid).then(async (space) =>
                  space && row
                    ? await paymentRead(env, dir, {
                      ...space,
                      ...row.paymentAccount as Partial<typeof space>,
                    }, part)
                    : []
                ).then(
                  (bundles) => mine == asked && sink({ bundles, reset: true }),
                  (error) => mine == asked && sink({ refused: error }),
                )
              })
            }
            if (line != UPDATE_WAITING && personLine(line)) {
              return personal(sink)
            }
            if (once(line)) {
              let closed = false
              readOnce(line).then(
                (bundles) => closed || sink({ bundles, reset: true }),
                (error) => closed || sink({ refused: error }),
              )
              return () => {
                closed = true
              }
            }
            // The person's agents, which no store holds: read again each
            // time the directory says their grants moved.
            if (line == AGENTS) {
              return rereading(
                () => agentsIn(env, dir, person),
                (moved) => personal(moved, GRANTS),
                sink,
              )
            }
            // What an app beside the chat is made of, read again as it moves.
            let app = makingApp(line)
            if (app != undefined) return watchMaking(env, dir, who, app, sink)
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
            // Visits, which no store holds: read again whole each time the
            // space's apps move, the latest read the one that stands.
            let counted = countsSpace(line)
            if (counted != undefined) {
              let asked = 0
              let stop = personal((frame) => {
                if (frame.refused) return sink(frame)
                let mine = ++asked
                let latest = () => mine == asked
                visitsRows(env, dir, person, counted).then(
                  ({ counts }) =>
                    latest() && sink({ bundles: counts, reset: true }),
                  (refused) => latest() && sink({ refused }),
                )
              }, sideApps(counted))
              return () => {
                asked = NaN
                stop()
              }
            }
            // The Connections page, which no store answers: read again
            // whole each time the directory says it moved, as a read of the
            // person (`connectionsMoved`): the space's connections and the
            // person's, the links its apps call out through, its apps, and
            // the person's MCP servers.
            let page = pageAsked(line)
            if (page) {
              let closed = false
              let stop: (() => void) | undefined
              owning(page.space).then((seat) => {
                if (closed) return
                if (!seat) return sink({ bundles: [], reset: true })
                stop = rereading(
                  () => connectionsAt(seat, page.ask),
                  (moved) => personal(moved, connectionsMoved(seat.space.eid)),
                  sink,
                )
              }, (error) => closed || sink({ refused: error }))
              return () => {
                closed = true
                stop?.()
              }
            }
            // What the space's Operator store answers of the person.
            let operator = cardsSpace(line) ?? draftsSpace(line) ??
              settingsSpace(line) ?? matchesAsked(line)?.space
            if (operator != undefined) {
              let closed = false
              let stop: (() => void) | undefined
              seatIn(operator).then((seat) => {
                if (closed) return
                if (!seat) return sink({ bundles: [], reset: true })
                let ask = builderOf(env, operator)
                stop = watching(
                  doorOf((req) => ask(() => req)),
                  seat.space.slug,
                  line,
                  sink,
                  { ...vouched(who), [SPACE]: operator },
                  '/api/waiting/ws',
                )
              }, (error) => closed || sink({ refused: error }))
              return () => {
                closed = true
                stop?.()
              }
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
