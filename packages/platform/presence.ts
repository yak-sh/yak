/**
 * A friend's presence as a list of friends shows it (yaks.app's friends
 * dock, ./friends-dock-view.ts): online now, with a green dot, or "Active 3
 * hours ago", online friends first.
 *
 * ```ts
 * import { ordered, seenWords } from '@yaks/platform/presence'
 * import { equal } from '@yaks/testing'
 *
 * let now = Date.parse('2026-11-24T12:00:00Z')
 * equal(seenWords({ state: 'online' }, now), 'Online now')
 * equal(seenWords({ state: 'away', last: '2026-11-24T09:00:00Z' }, now), 'Active 3 hours ago')
 * equal(seenWords(undefined, now), '')
 * let friends = [
 *   { name: 'Ann' },
 *   { name: 'Bo', seen: { state: 'away' as const, last: '2026-11-20T09:00:00Z' } },
 *   { name: 'Cy', seen: { state: 'away' as const, last: '2026-11-24T09:00:00Z' } },
 *   { name: 'Dee', seen: { state: 'building' as const } },
 * ]
 * equal(ordered(friends, (f) => f.seen).map((f) => f.name), ['Dee', 'Cy', 'Bo', 'Ann'])
 * ```
 *
 * @module
 */

import { said } from '@yaks/ui/relative'

/** Where one friend is, as a reader may see it: building or online now, or
 * away since they were `last` active. None when they or the reader hide it,
 * or they were never on yaks.app. */
export type Seen = { state?: 'building' | 'online' | 'away'; last?: string }

/** Whether they are on yaks.app now. */
export let online = (s?: Seen): boolean =>
  s?.state == 'building' || s?.state == 'online'

/** The words under a friend's name: "Online now", "Building now", "Active
 * 3 hours ago", or none. */
export let seenWords = (s: Seen | undefined, now: number): string =>
  online(s)
    ? s!.state == 'building' ? 'Building now' : 'Online now'
    : s?.last
    ? `Active ${said(s.last, { now })}`
    : ''

/** Friends in the order they are listed: online first, then the most
 * recently active, then the rest in the order they came. */
export let ordered = <T>(
  friends: T[],
  seen: (f: T) => Seen | undefined,
): T[] => {
  let rank = (s?: Seen) => online(s) ? 0 : s?.last ? 1 : 2
  return friends.map((f, i) => ({ f, i, s: seen(f) })).sort((a, b) =>
    rank(a.s) - rank(b.s) ||
    (rank(a.s) == 1 ? b.s!.last!.localeCompare(a.s!.last!) : 0) ||
    a.i - b.i
  ).map(({ f }) => f)
}
