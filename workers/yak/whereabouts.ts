// Where each person is available now (@yaks/notify/whereabouts), kept in the
// directory as `whereabouts` rows: what each channel last said, written only
// when it changes or is about to fade. The channels say it here: the
// Operator's page over its socket (build.ts), an app's page or another
// yaks.app page over its own (graph.ts), Discord's gateway (chat.ts), and a text or an
// email reaching the Operator. Only a person's own Operator reads theirs.

import type { Bundle } from '@yaks/graph'
import { line } from '@yaks/query'
import {
  ago,
  type Channel,
  FADE,
  type Glance,
  glance,
  noted,
  reachBy,
  type Said,
  whereaboutsEid,
  whereaboutsLine,
} from '@yaks/notify/whereabouts'
import type { Tool } from '@yaks/session'
import type { Env } from './env.ts'
import { type Directory, url } from './directory.ts'
import type { Host as HostEnv } from '@yaks/platform/host'

/** The directory as whereabouts reads and writes it. */
export type Kept = {
  read: (q: string) => Bundle[] | Promise<Bundle[]>
  apply: (bundles: Bundle[]) => unknown
}

/** The directory, read and written as the kernel. */
export let kept = async (env: Pick<Env, 'STORE'>): Promise<Kept> => {
  let { ctxOf } = await import('./connections.ts')
  let { graph } = ctxOf(env)
  return { read: (q) => graph.read(q as never), apply: graph.apply }
}

/** Keep what a channel said of a person, if it is news. */
export let present = async (
  env: Pick<Env, 'STORE'>,
  said: Said,
  now: number = Date.now(),
  dir?: Kept,
): Promise<void> => {
  dir ??= await kept(env)
  let eid = whereaboutsEid(said.person, said.channel, said.place)
  let [row] = await dir.read(line`.entity.eid=${eid}&.whereabouts&*`)
  let next = noted(row, said, now)
  if (next) await dir.apply([next as Bundle])
}

/** A person's whereabouts rows, read for their own Operator. */
export let whereaboutsOf = async (
  env: Pick<Env, 'STORE'>,
  person: string,
  dir?: Kept,
): Promise<Bundle[]> => {
  dir ??= await kept(env)
  return await dir.read(line`.whereabouts.person=${person}&*`)
}

/** What a person's own Operator (of space `place`) sees of them, none for
 * someone never seen on any channel (a guest, a room). */
export let seen = async (
  env: Pick<Env, 'STORE'>,
  person: string,
  place: string,
  now: number = Date.now(),
  dir?: Kept,
): Promise<Glance | undefined> => {
  let rows = await whereaboutsOf(env, person, dir)
  return rows.length ? glance(rows, { place, now }) : undefined
}

/** The line each turn of a person's own Operator is given, about them and
 * no one else: "Jeff: here, this tab · Discord online". */
export let whereaboutsItem = async (
  env: Pick<Env, 'STORE'>,
  person: string,
  place: string,
  dir?: Kept,
): Promise<string | undefined> => {
  dir ??= await kept(env)
  let [g, [row]] = await Promise.all([
    seen(env, person, place, Date.now(), dir),
    dir.read(line`.entity.eid=${person}&.fields=entity.eid,doc.title`),
  ])
  if (!g) return
  let name = String((row?.doc as { title?: string })?.title || 'They')
  return 'Where the person you are talking with is now, which says where ' +
    'to reach them (whereabouts_show has more): ' + whereaboutsLine(name, g)
}

/** The Operator's `whereabouts_show`: where the person it works for is now,
 * channel by channel, and where something that needs them reaches them. A
 * page open says which it is: another space's Operator by its space, an app
 * by its address, read from the directory (`dir`). */
export let whereaboutsShow = (
  env: Pick<Env, 'STORE'> & HostEnv,
  person: string,
  space: string,
  dir: () => Pick<Directory, 'at' | 'appAt'>,
): Tool => {
  // Where a channel's row says they are: another space's Operator, or an
  // app's page, which names nothing once the app is gone.
  let placed = async (channel: string, place?: string) => {
    if (channel == 'operator') {
      if (place == space) return { here: 'this Operator' }
      let at = place ? await dir().at(place) : null
      return { here: at ? `the Operator of ${at.slug}` : 'another Operator' }
    }
    let held = channel == 'apps' && place ? await dir().appAt(place) : null
    return held && !held.app.trashed
      ? {
        app: `${held.space.slug}/${held.app.slug}`,
        url: url(held.space, held.app, env),
      }
      : {}
  }
  return {
    name: 'whereabouts_show',
    title: 'See where they are',
    readOnly: true,
    description:
      "Where the person you work for is available right now, channel by channel: this Operator open and focused or in a background tab, another space's Operator or an app's page open (which, with its address), their Discord status, and when they last texted or emailed you. `reach` says where something that needs them would reach them now: the tab they are looking at, a browser notification, Discord, or their usual channel. Only they are shown, never anyone else.",
    parameters: { type: 'object', properties: {} },
    run: async () => {
      let now = Date.now()
      let rows = await whereaboutsOf(env, person)
      let g = glance(rows, { place: space, now })
      let channels = await Promise.all(rows.map(async ({ whereabouts: p }) => {
        let at = (p as { at?: string })?.at
        if (!p || !at) return []
        let { channel, place, state } = p as Record<string, string>
        return [{
          channel,
          ...await placed(channel, place),
          state,
          ago: ago(at, now),
          faded: !(now - Date.parse(at) < FADE[channel as Channel]),
        }]
      }))
      return JSON.stringify({
        line: whereaboutsLine('They', g),
        reach: reachBy(g),
        channels: channels.flat(),
      })
    },
  }
}
