// `/api/tunnel` and the machine behind a space's tunnel, as yaks.app lends
// them to @yaks/tunnel/hosted (D-39583), which says what the door answers,
// who may open or reach a tunnel and how a request goes on to a machine. This
// is the Cloudflare edge it stands on: the directory a space and its seats
// are read from, the tokens the account and the gateways are reached with,
// the apps' dispatch namespace a request is handed to its gateway through
// (`through`), and the Operator a machine's word is taken in by (`tell`).
//
// The machine runs `cloudflared` with its tunnel's token and dials out, so it
// opens no port. Adopting a pair is the platform owner's: an owner of `yak`,
// a seat in the fee's gate (sell.ts `fees`).
//
// The gateway is the one Worker bound to the tunnel's VPC Service, a script
// in the apps' dispatch namespace named for the space (@yaks/tunnel
// `gatewayOf`), so only this Worker calls it: an app's script name always
// holds an underscore (dispatch.ts `scriptName`), and a gateway's never does.
// An app's own worker reaches it as `env.BOX` or whatever its config's
// `vpc_services` names (dispatch.ts `shim`), which is `/api/tunneled/…` at
// the app's address acting as the app (`reach` below, through apps.ts).
//
// The space's owner reaches the same gateway with no app between (`machine`
// below): the MCP servers they keep on the machine are asked through it
// (@yaks/connections/mcp), each request naming the Operator conversation it was made
// in and whose it is, which no app's request may say for itself.
//
// The machine speaks back by the owner's own connection, not the tunnel: what
// changed there that one of their conversations started or is waiting on
// (@yaks/tunnel effects.ts) is told here (`tell` below), and their Operator
// takes it in on its `machine` channel and decides whether they hear of it.
//
// A website session or an OAuth token opens this door, never a pasted grant.
// Under `/api/`, the same-origin guard (@yaks/platform/routes `guarded`)
// stands in front of it the way it stands in front of the fee.
import { type Api, gateways } from '@yaks/tunnel'
import {
  type Calling,
  door,
  gatewayOf,
  type Keeping,
  machine as reached,
  owners,
  reach as reaching,
  type Relay,
} from '@yaks/tunnel/hosted'
import type { Told } from '@yaks/tunnel/effects'
import * as dirPart from './directory.ts'
import { type App, directory, type Space, stamp } from './directory.ts'
import type { Who } from './session.ts'
import { itsApp, namespace, nowhere, script } from './dispatch.ts'
import { bound, type Env } from './env.ts'
import { resent } from '@yaks/cloudflare/api'
import type { Answer } from './apps.ts'
import { caught } from './defects.ts'
import { adminWho } from './asking.ts'
import { elapsed } from './lib/hops.ts'
import { derivedEid } from '@yaks/graph/identity'
import { rootOf } from './operator-root.ts'

let dirOf = (env: Env) => directory(bound(env.DIRECTORY, dirPart.fetch, env))

// The account the platform makes tunnels in (CF_TUNNEL_TOKEN), or null until
// its token is set. Its calls, and the gateways' below, go through the fetch
// every Cloudflare call does (@yaks/cloudflare/api).
export let account = (env: Env): Api | null =>
  env.CF_TUNNEL_TOKEN && env.CF_ACCOUNT
    ? { account: env.CF_ACCOUNT, token: env.CF_TUNNEL_TOKEN, fetch: resent }
    : null

// The gateways, in the namespace the apps' workers live in and uploaded with
// the token that uploads those (CF_WORKERS_TOKEN, dispatch.ts), or null until
// it is set.
export let front = (env: Env) =>
  env.CF_WORKERS_TOKEN && env.CF_ACCOUNT
    ? gateways(
      { account: env.CF_ACCOUNT, token: env.CF_WORKERS_TOKEN, fetch: resent },
      namespace(env),
    )
    : null

// What the door reads through: whoever signed in, a space by its slug and
// where they sit in it and in the platform's own, and the record, written
// through the kernel's door, where every property of `tunnel` is stamped.
let keeping = (env: Env, req: Request): Keeping => {
  let dir = dirOf(env)
  let caller = adminWho(env, req, () => Promise.resolve(null))
  return {
    account: account(env),
    gateways: front(env),
    who: async () => (await caller).person,
    find: async (slug, person) => {
      let [space, meta] = await Promise.all([
        dir.space(slug),
        dir.space(dirPart.META.space),
      ])
      if (!space) return null
      let [role, chief] = person
        ? await Promise.all([
          dir.role(space, person),
          meta ? dir.role(meta, person) : null,
        ])
        : [null, null]
      return {
        eid: space.eid,
        slug: space.slug,
        tunnel: space.tunnel,
        tunnelTrashed: space.tunnelTrashed,
        owner: role == 'owner',
        platform: chief == 'owner',
      }
    },
    write: async (eid, tunnel) => {
      let who = await caller
      return stamp(env, { entities: [{ entity: { eid }, tunnel }] }, {
        actor: { by: who.actor ?? who.person!, via: who.via },
      })
    },
    trash: async (eid, at) => {
      let who = await caller
      return stamp(env, {
        entities: [{ entity: { eid }, tunnel_trashed: at ? { at } : null }],
      }, { actor: { by: who.actor ?? who.person!, via: who.via } })
    },
    purge: async (space) => {
      let who = await caller
      let { requested } = await import('./confirm.ts')
      let { trashedTunnel } = await import('./tunnel-trash.ts')
      return requested(
        env,
        dir,
        (await dir.at(space.eid))!,
        who.person!,
        trashedTunnel,
        space.eid,
        space.tunnel!,
      )
    },
    tell: (person, told) => tell(env, person, told),
  }
}

export let fetch = (req: Request, env: Env): Promise<Response> =>
  door(req, keeping(env, req))

/**
 * What the machine behind a space's tunnel tells its owner's Operator: the
 * words of a knock at the session standing there for their conversation,
 * taken in as a request on the Operator's `machine` channel, in the space of
 * theirs with a tunnel whose Operator holds `conversation` (their one
 * conversation, or a session that works for it), or null where none does.
 * The knock (`key`) names the request, so a knock told again is one request.
 * What it tells of (`about`) rides with the request, so an alert about it
 * opens at its row. The Operator decides whether they hear of it
 * (operator-channels.ts).
 */
let tell = async (
  env: Env,
  person: string,
  told: Told,
): Promise<{ space: string; request?: string } | null> => {
  let dir = dirOf(env)
  let owned = [...await dir.sitting(person)]
    .filter(([, role]) => role == 'owner').map(([eid]) => eid)
  let spaces = (await Promise.all(owned.map((eid) => dir.at(eid))))
    .filter((s): s is Space =>
      !!s && !s.trashed && !!s.tunnel && !s.tunnelTrashed
    )
  let { builderOf, SPACE } = await import('./build-door.ts')
  let asked = (at: Space, path: string, args: object) =>
    builderOf(env, at.eid)(() =>
      new Request(`https://builder${path}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-yak-person': person,
          [SPACE]: at.eid,
        },
        body: JSON.stringify(args),
      })
    )
  let holds = async (at: Space) => {
    let r = await asked(at, '/operator/read', { task: told.conversation })
    await r.body?.cancel()
    return r.ok
  }
  let space = spaces.find((s) => rootOf(s.eid, person) == told.conversation)
  for (let at of space ? [] : spaces) {
    if (await holds(at)) {
      space = at
      break
    }
  }
  if (!space) return null
  let r = await asked(space, '/operator/receive', {
    say: told.text,
    request: {
      channel: 'machine',
      ...told.about ? { about: told.about } : {},
    },
    options: { id: derivedEid(`operator-machine|${space.eid}|${told.key}`) },
  })
  let body = await r.json() as { request?: string; message?: string }
  if (!r.ok) {
    throw new Error(
      `the Operator refused a machine's word (${r.status}): ${body.message}`,
    )
  }
  return { space: space.slug, request: body.request }
}

/** The one call through a space's tunnel: `out` handed to the space's
 * gateway, which marks it as the tunnel's and passes it to the machine. The
 * namespace runs every script for an app and its visitor (dispatch.ts
 * `script`), so the call names who asks. Null for a tunnel with no gateway; a
 * throw is the tunnel or the machine not answering. */
let through = (
  env: Pick<Env, 'DISPATCH'>,
  space: Pick<Space, 'eid'>,
  app: Pick<App, 'eid'>,
  who: Pick<Who, 'person' | 'role' | 'visit'>,
): Relay =>
async (out) => {
  if (!env.DISPATCH) return null
  try {
    return await script(env.DISPATCH, gatewayOf(space.eid), app, who)
      .fetch(out)
  } catch (e) {
    if (nowhere(e)) return null
    throw e
  }
}

/** An app's own worker reaching the machine its space's tunnel goes to
 * (@yaks/tunnel/hosted `reach`), as the app itself: its grant names the app
 * (dispatch.ts `itsApp`). A machine that did not answer is reported. */
export let reach: Answer = ({ env, req, path, space, app, who }) =>
  reaching(
    req,
    path,
    { space, app, itself: itsApp(who, app) },
    through(env, space, app, who),
    (e) => caught(e, { request: 'tunnel', space: space.slug, app: app.slug }),
  )

/** The machine a space's tunnel goes to, as a `fetch` for the space's owner
 * and nobody else (@yaks/tunnel/hosted `owners`): null to a member, to a
 * stranger, and for a space that is gone. Who owns the space is read from the
 * whole directory as this call finds it, never from a narrowed view of it or
 * from a row written earlier. Asked for the space itself, which is no app: a
 * gateway calls nothing out, so no connection is lent on this call. Its wait
 * is the request's `machine_wait` (timing.ts). */
export let machine = async (
  env: Env,
  at: string,
  person: string,
  asking: Calling = { caller: 'connector' },
): Promise<typeof globalThis.fetch | null> => {
  if (!person || !at) return null
  let dir = dirOf(env)
  let [space, seats] = await Promise.all([dir.at(at), dir.sitting(person)])
  let role = seats.get(at)
  if (!space || space.trashed || !role || !owners(role, at, asking)) {
    return null
  }
  let relay = through(env, space, space, { person, role })
  return reached(
    space,
    person,
    asking,
    (out) => elapsed('machine_wait', () => relay(out)),
  )
}
