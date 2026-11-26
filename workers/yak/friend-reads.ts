// The directory reads behind an app's friends and their shared whereabouts.
import {
  sidesOf,
  type Stand,
  type Standing,
  standings,
} from '@yaks/platform/friends'
import type { Row } from '@yaks/notify/whereabouts'
import type { Directory } from './directory.ts'
import { nameOf } from './names.ts'

// Every friend side `person` is at either end of, and the people at their
// ends, in one read.
let sidesRead = (dir: Directory, person: string) => dir.read(sidesOf(person))

// Where everyone stands with `person`, unnamed.
export let standingsOf = async (dir: Directory, person: string) =>
  standings(person, await sidesRead(dir, person))

/** Another person, where they stand with the reader, and since when. */
export type Friend = Stand & { person: string; name: string }

/** Everyone who stands somewhere with `person`, named, friends first and
 * then by name. */
export let friendsOf = async (
  dir: Directory,
  person: string,
): Promise<Friend[]> => {
  let order: Standing[] = ['friend', 'asked', 'suggested', 'asking']
  let rows = await sidesRead(dir, person)
  let named = new Map(rows.map((r) => [
    r.entity.eid,
    nameOf(
      (r.doc as { title?: string } | undefined)?.title,
      (r.email as { address?: string } | undefined)?.address ?? '',
    ),
  ]))
  return [...standings(person, rows)].map(([other, stand]) => ({
    person: other,
    name: named.get(other) || 'Someone on yaks.app',
    ...stand,
  })).sort((a, b) =>
    order.indexOf(a.standing) - order.indexOf(b.standing) ||
    a.name.localeCompare(b.name)
  )
}

/** A friend's whereabouts when both people share presence. */
export let friendWhereabouts = async (
  dir: Directory,
  reader: string,
  friends: string[],
): Promise<Map<string, Row[]>> => {
  if (!friends.length || await dir.presenceHidden(reader)) return new Map()
  let hidden = await Promise.all(friends.map((f) => dir.presenceHidden(f)))
  let visible = friends.filter((_, i) => !hidden[i])
  let seen = new Map(visible.map((f) => [f, [] as Row[]]))
  for (let row of await dir.whereabouts(visible)) {
    let person = row.whereabouts?.person
    if (person) seen.get(person)?.push(row)
  }
  return seen
}
