/**
 * Where a person is available right now, channel by channel: the Operator's
 * page open and focused, open in a background tab, an app's page open,
 * Discord's status, and when they last texted or emailed. Each is a
 * `whereabouts` row a host writes when the channel says something new
 * ({@link noted}), and each fades on its own once the channel has gone quiet
 * longer than its {@link FADE}, so a dropped socket or a lost close never
 * leaves someone "here" for good.
 *
 * Pure: a host reads the rows, applies what {@link noted} returns, and reads
 * {@link glance} to say it ({@link whereaboutsLine}) or to choose where to reach
 * the person ({@link reachBy}).
 *
 * ```ts
 * import { glance, noted, whereaboutsLine, reachBy } from '@yaks/notify/whereabouts'
 * import { equal } from '@yaks/testing'
 *
 * let now = Date.parse('2026-11-20T12:00:00Z')
 * let tab = noted(undefined, { person: 'jeff', channel: 'operator', place: 'home', state: 'here' }, now)!
 * let discord = noted(undefined, { person: 'jeff', channel: 'discord', state: 'online' }, now)!
 * let seen = glance([tab, discord], { place: 'home', now })
 * equal(whereaboutsLine('Jeff', seen), 'Jeff: here, this tab · Discord online')
 * equal(reachBy(seen), 'tab')
 * // The same state said again soon after writes nothing.
 * equal(noted(tab, { person: 'jeff', channel: 'operator', place: 'home', state: 'here' }, now + 1000), undefined)
 * ```
 */

import { derivedEid } from '@yaks/graph/identity'

export type Channel = 'operator' | 'apps' | 'discord' | 'text' | 'email'
export type State =
  | 'here'
  | 'background'
  | 'away'
  | 'open'
  | 'online'
  | 'idle'
  | 'dnd'
  | 'offline'
  | 'used'

/** What a channel said of a person: `place` is which Operator (its space)
 * or which app, for the channels a person can have several of. */
export type Said = {
  person: string
  channel: Channel
  place?: string
  state: State
}

/** A `whereabouts` row as a host reads it. */
export type Row = {
  entity: { eid: string }
  whereabouts?: Partial<Said> & { at?: string }
}

let MINUTE = 60_000
let HOUR = 60 * MINUTE

/** How long a channel's last word stands. A page says its state again while
 * it is open ({@link BEAT}), so a page whose close was lost fades in minutes;
 * Discord says a change only when there is one, and resends every status
 * when its bot reconnects; a text or an email is a moment, said as "texted
 * 2h ago" for a day. */
export let FADE: Record<Channel, number> = {
  operator: 15 * MINUTE,
  apps: 15 * MINUTE,
  discord: 12 * HOUR,
  text: 24 * HOUR,
  email: 24 * HOUR,
}

/** How often an open page says its state again. */
export let BEAT: number = 5 * MINUTE

// A state that says the person is not there: never worth a new row.
let gone = (s?: string) => s == 'away' || s == 'offline'

/** The row a person's whereabouts on `channel` (at `place`) is kept in. */
export let whereaboutsEid = (
  person: string,
  channel: Channel,
  place?: string,
): string => derivedEid(`whereabouts|${person}|${channel}|${place ?? ''}`)

/**
 * The write `said` needs, given the row it replaces: none when the state is
 * unchanged and its row is still fresh (younger than a third of its fade),
 * so a page saying "still here" every {@link BEAT} writes about once in
 * three, and Discord's many identical updates write once. A person never
 * seen there who is said to be away writes nothing.
 */
export let noted = (
  row: Row | undefined,
  said: Said,
  now: number = Date.now(),
): Row | undefined => {
  let was = row?.whereabouts
  let age = now - Date.parse(was?.at ?? '')
  if (!was?.state && gone(said.state)) return
  if (was?.state == said.state && age < FADE[said.channel] / 3) return
  if (gone(said.state) && (gone(was?.state) || !(age < FADE[said.channel]))) {
    return
  }
  return {
    entity: { eid: whereaboutsEid(said.person, said.channel, said.place) },
    whereabouts: {
      person: said.person,
      channel: said.channel,
      ...said.place ? { place: said.place } : {},
      state: said.state,
      at: new Date(now).toISOString(),
    },
  }
}

/** One tab's say: whether its page is visible and has focus. A page says it
 * on its socket as `{tab}` when it changes and every {@link BEAT}. */
export type Tab = { visible: boolean; focused: boolean }

/** The tab a socket's frame says, none for any other frame. */
export let tabSaid = (frame: unknown): Tab | undefined => {
  let tab = (frame as { tab?: unknown } | null)?.tab
  if (!tab || typeof tab != 'object') return
  let { visible, focused } = tab as Record<string, unknown>
  return { visible: visible === true, focused: focused === true }
}

/** The state of a page across a person's tabs on it: `here`
 * when one is visible and focused, `background` when one is open, `away`
 * when none is. */
export let tabsState = (tabs: Tab[]): State =>
  tabs.some((t) => t.visible && t.focused)
    ? 'here'
    : tabs.length
    ? 'background'
    : 'away'

/** Where a person is, at a glance, as one Operator (of `place`) sees it. */
export type Glance = {
  /** this Operator's page: focused, or open in a background tab */
  tab?: 'here' | 'background'
  /** another Operator's page or an app's page is open */
  elsewhere?: boolean
  discord?: 'online' | 'idle' | 'dnd' | 'offline'
  /** when they last texted, or emailed, within a day */
  texted?: string
  emailed?: string
  now: number
}

/** The rows still standing, read as one Operator's glance: `place` is its
 * space. */
export let glance = (
  rows: Row[],
  { place, now = Date.now() }: { place?: string; now?: number },
): Glance => {
  let seen: Glance = { now }
  for (let { whereabouts: p } of rows) {
    if (!p?.channel || !p.state || !p.at) continue
    let channel = p.channel as Channel
    if (!(now - Date.parse(p.at) < (FADE[channel] ?? 0))) continue
    if (channel == 'operator' && p.place == place) {
      if (p.state == 'here' || p.state == 'background') {
        seen.tab = seen.tab == 'here' ? 'here' : p.state
      }
    } else if (channel == 'operator' || channel == 'apps') {
      if (!gone(p.state)) seen.elsewhere = true
    } else if (channel == 'discord') {
      seen.discord = p.state as Glance['discord']
    } else if (channel == 'text') seen.texted = latest(seen.texted, p.at)
    else if (channel == 'email') seen.emailed = latest(seen.emailed, p.at)
  }
  return seen
}

/** Where a person is on yaks.app now, as their friends see it: `building`
 * while an Operator's page of theirs is open, else `online` while an app's
 * page or another yaks.app page is; `spaces` and `apps` are the places those
 * pages name, the Operator's space and the app. */
export type Presence = {
  state: 'building' | 'online'
  spaces: string[]
  apps: string[]
}

/** The presence the rows still standing say, none when no page of the
 * person's is open. Never stored: it is read off the rows each time. */
export let presence = (
  rows: Row[],
  now: number = Date.now(),
): Presence | undefined => {
  let spaces = new Set<string>(), apps = new Set<string>()
  let open = false
  for (let { whereabouts: p } of rows) {
    let channel = p?.channel
    if (channel != 'operator' && channel != 'apps') continue
    if (!p?.state || gone(p.state) || !p.at) continue
    if (!(now - Date.parse(p.at) < FADE[channel])) continue
    open = true
    if (p.place) (channel == 'operator' ? spaces : apps).add(p.place)
  }
  if (!open) return
  return {
    state: spaces.size ? 'building' : 'online',
    spaces: [...spaces],
    apps: [...apps],
  }
}

let latest = (a: string | undefined, b: string) => !a || b > a ? b : a

/** How long ago `at` was, as a person says it: 4m, 2h, 1d. */
export let ago = (at: string, now: number): string => {
  let ms = Math.max(0, now - Date.parse(at))
  return ms < HOUR
    ? `${Math.max(1, Math.round(ms / MINUTE))}m`
    : ms < 24 * HOUR
    ? `${Math.round(ms / HOUR)}h`
    : `${Math.round(ms / (24 * HOUR))}d`
}

let DISCORD: Record<string, string> = {
  online: 'Discord online',
  idle: 'Discord idle',
  dnd: 'Discord do not disturb',
  offline: 'Discord offline',
}

/** The glance in one short line, for each of an Operator's turns:
 * "Jeff: here, this tab · Discord online". */
export let whereaboutsLine = (name: string, g: Glance): string => {
  let parts = [
    g.tab == 'here'
      ? 'here, this tab'
      : g.tab == 'background'
      ? 'this Operator open in a background tab'
      : g.elsewhere
      ? 'on yaks.app, not on this Operator'
      : 'not on yaks.app',
    g.discord && DISCORD[g.discord],
    g.texted && `texted ${ago(g.texted, g.now)} ago`,
    g.emailed && `emailed ${ago(g.emailed, g.now)} ago`,
  ]
  return `${name}: ${parts.filter(Boolean).join(' · ')}`
}

/** Where something that needs the person reaches them now: in the tab they
 * are looking at, a notification when that tab is in the background or they
 * are elsewhere on yaks.app, Discord when they are on it and not on
 * yaks.app, and otherwise their usual channel. */
export type Reach = 'tab' | 'notification' | 'discord' | 'usual'
export let reachBy = (g: Glance): Reach =>
  g.tab == 'here'
    ? 'tab'
    : g.tab == 'background' || g.elsewhere
    ? 'notification'
    : g.discord == 'online'
    ? 'discord'
    : 'usual'
