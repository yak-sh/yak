// Voice, as what it contributes (plugin.ts): every app's ./api/rtc/ door onto
// Cloudflare Realtime, the one SFU app and TURN key the platform holds, and
// what happens when a session's lease lapses. The door itself is @yaks/rtc's;
// this file hands it the app's store, the space's meter and the account, and
// says who may knock.
//
// Who may: whoever may write the app's rows (@yaks/member `edits`) and is one
// of its members, or anyone who may write it where its manifest says
// `"rtc": "open"` (vocab.ts `OPENS`), the way `"models": "open"` opens its
// models. A visitor is held per app to RTC_RATE (rate.ts).
//
// What it costs: Realtime charges $0.05 a GB leaving Cloudflare, after the
// account's free 1,000 GB a month, and nothing going in. A session is weighed
// by what it receives: each remote audio track at the 32 kbit/s Opus @yaks/rtc
// publishes, about 48 kbit/s on the wire, and each DataChannel at a flat 16
// kbit/s. The owner pays from the account budget shared with models
// (meter.ts `realtime`).
import { edits, mode, writes } from '@yaks/member'
import {
  answer,
  lapse,
  type Rates,
  type Realtime,
  type Store,
} from '@yaks/rtc/door'
import { appStore, directoryOf } from './directory.ts'
import type { Door } from './door.ts'
import type { Env } from './env.ts'
import { KERNEL, metaOf } from './meta.ts'
import { countedRealtime, refusedSpend } from './meter.ts'
import { type Answer, type Effect, page, type Plugin } from './plugin.ts'
import { source, within } from './rate.ts'
import { defect } from './sentry.ts'

/** Realtime's egress price, in dollars a byte. */
let BYTE = 0.05 / 1e9

/** What a session costs a second, per remote track and channel it receives. */
export let RATES: Rates = {
  track: 48_000 / 8 * BYTE,
  channel: 16_000 / 8 * BYTE,
}

/** The platform's Realtime account, or null where its secrets are unset. */
export let realtimeOf = (env: Partial<Env>): Realtime | null =>
  env.REALTIME_APP && env.REALTIME_TOKEN
    ? {
      app: env.REALTIME_APP,
      token: env.REALTIME_TOKEN,
      ...(env.TURN_KEY && env.TURN_TOKEN
        ? { turn: { key: env.TURN_KEY, token: env.TURN_TOKEN } }
        : {}),
      ...(env.REALTIME_API ? { api: env.REALTIME_API } : {}),
    }
    : null

// The app's store as the kernel reads and writes it: the `sfu` rows are the
// platform's own, written by nobody else.
let kept = (door: Door): Store => {
  let meta = metaOf(door, KERNEL)
  return { read: meta.query, write: (bundles) => meta.apply(bundles, KERNEL) }
}

// Whether the app's own manifest opens its voice to visitors.
let opened = (door: Door) => {
  return door.consume(
    '/vocab',
    async (r) => r.ok && (await r.json() as { rtc?: string }).rtc == 'open',
    {},
    KERNEL,
  )
}

/** ./api/rtc/*: the door, for whoever may use it. */
export let voice: Answer = async (asked) => {
  let { env, req, path, space, app, who, refuse, json } = asked
  if (!path.startsWith('/rtc/')) return null
  if (!edits(mode(app.access), who.role)) return refuse()
  let realtime = realtimeOf(env)
  if (!realtime) {
    return json(503, 'voice_off', 'voice is not switched on here')
  }
  let door = appStore(env.STORE, space, app, env)
  if (!writes(who.role)) {
    if (!await opened(door)) {
      return who.person
        ? json(
          403,
          'not_a_member',
          "only this app's members may speak here — its owner can make you " +
            'an editor',
        )
        : refuse()
    }
    let key = `${app.eid} ${who.person ?? source(req)}`
    if (!await within(env.RTC_RATE, key)) {
      return json(
        429,
        'too_many_requests',
        'that is a lot of calls in one minute — wait a moment and try again',
      )
    }
  }
  // Read past the directory's cache, so a refusal reads the spend before it.
  let dir = directoryOf(env.STORE)
  return answer({
    req,
    path: path.slice('/rtc'.length),
    store: kept(door),
    meter: {
      refused: () => refusedSpend(dir, space, 'realtime', env),
      spend: (dollars) => countedRealtime(env, space, dollars),
    },
    realtime,
    rates: RATES,
    label: app.eid,
    report: (e) =>
      defect(e, { request: `rtc ${path}`, space: space.slug, app: app.slug }),
  })
}

/**
 * A session whose lease lapsed: its wake fired, so its tracks are closed at
 * Realtime and its row dropped (@yaks/rtc `lapse`). Not waited for, since it
 * speaks to Cloudflare; a failure is reported and leaves the row, which the
 * page's next renewal finds and pays for again.
 */
let lapsing: Effect = (on, at) => {
  if (at.meta || !at.app) return
  let app = at.app
  let store: Store = {
    read: async (q) => await at.graph.read(q),
    write: async (bundles) => await at.graph.apply(bundles),
  }
  on.on('.sfu, .fired', (e) => {
    let realtime = realtimeOf(at.env)
    if (!realtime) return
    void (async () => {
      let [row] = await store.read(`.eid=${e.entity.eid}`)
      if (row?.sfu) await lapse(realtime, store, row)
    })().catch((error) => defect(error, { request: 'rtc lapse', app }))
  })
}

/** Voice, as a plugin of this Worker: the door at every app's address, the
 * lapse in every app's store, and the guide page. */
export let rtcPlugin: Plugin = {
  name: 'rtc',
  pages: [page('voice')],
  answers: [voice],
  effects: [lapsing],
}
