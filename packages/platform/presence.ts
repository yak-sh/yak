/**
 * A friend's presence as a list of friends shows it (yaks.app's friends
 * dock, ./friends-dock-view.ts): active, away or offline, with online
 * friends first.
 *
 * ```ts
 * import { ordered, seenWords } from '@yaks/platform/presence'
 * import { equal } from '@yaks/testing'
 *
 * let now = Date.parse('2026-11-24T12:00:00Z')
 * equal(seenWords({ activity: 'active' }, now), 'Active now')
 * equal(seenWords({ activity: 'away' }, now), 'Away')
 * equal(seenWords({ activity: 'offline', last: '2026-11-24T09:00:00Z' }, now), 'Active 3 hours ago')
 * equal(seenWords(undefined, now), '')
 * let friends = [
 *   { name: 'Ann' },
 *   { name: 'Bo', seen: { state: 'away' as const, last: '2026-11-20T09:00:00Z' } },
 *   { name: 'Cy', seen: { state: 'away' as const, last: '2026-11-24T09:00:00Z' } },
 *   { name: 'Dee', seen: { activity: 'active' as const } },
 * ]
 * equal(ordered(friends, (f) => f.seen).map((f) => f.name), ['Dee', 'Cy', 'Bo', 'Ann'])
 * ```
 *
 * @module
 */

import { said } from '@yaks/ui/relative'
import type { Seen as FriendSeen } from './account-rows.ts'

/** Where one friend is, as a reader may see it. */
export type Seen = Partial<Pick<FriendSeen, 'activity' | 'state' | 'last'>>

/** Activity in a live answer or in an older page's cached friends. */
export let activityOf = (s?: Seen): Seen['activity'] =>
  s?.activity ??
    (s?.state == 'building' || s?.state == 'online'
      ? 'away'
      : s
      ? 'offline'
      : undefined)

/** Whether the friend has a page open. */
export let online = (s?: Seen): boolean => {
  let activity = activityOf(s)
  return activity == 'active' || activity == 'away'
}

/** The words under a friend's name. A hidden presence says nothing. */
export let seenWords = (s: Seen | undefined, now: number): string => {
  switch (activityOf(s)) {
    case 'active':
      return 'Active now'
    case 'away':
      return 'Away'
    case 'offline':
      return s?.last ? `Active ${said(s.last, { now })}` : 'Offline'
    default:
      return ''
  }
}

/** Friends in the order they are listed: online first, then the most
 * recently active, then the rest in the order they came. */
export let ordered = <T>(
  friends: T[],
  seen: (f: T) => Seen | undefined,
): T[] => {
  let rank = (s?: Seen) => {
    let activity = activityOf(s)
    return activity == 'active' ? 0 : activity == 'away' ? 1 : s?.last ? 2 : 3
  }
  return friends.map((f, i) => ({ f, i, s: seen(f) })).sort((a, b) =>
    rank(a.s) - rank(b.s) ||
    (rank(a.s) == 2 ? b.s!.last!.localeCompare(a.s!.last!) : 0) ||
    a.i - b.i
  ).map(({ f }) => f)
}
