// Names used by the vale's commands resolve to one land or entity. A hero's
// current look wins over an older name; an ambiguous name needs an eid.
import type { Bundle } from './net.ts'
import { comp } from './bundle.ts'
import { levelOf, LEVELS } from './levels.ts'
import { GIVERS } from './quests.ts'
import { eidOf } from './villager-id.ts'

export type Target = { level: string } | { eid: string }
export type Query = (line: string) => Promise<Bundle[]>

let nameOf = (text: string) =>
  text.toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, '')
let eid = (text: string) =>
  /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(text)
let look = (b: Bundle) => comp(b, 'look')

/** Resolve a command target without letting an old look rename a hero. */
export let resolveTarget = async (
  input: string,
  query: Query,
): Promise<Target | null> => {
  let wanted = nameOf(input.trim())
  if (!wanted) return null
  let grown = levelOf(input.trim())
  if (grown) return { level: grown.id }
  let land = Object.values(LEVELS).find((l) =>
    wanted == nameOf(l.id) || wanted == nameOf(l.name)
  )
  if (land) return { level: land.id }
  let villager = GIVERS.find((g) =>
    wanted == nameOf(g.id) || wanted == nameOf(g.name)
  )
  if (villager) return { eid: eidOf(villager.id) }
  if (eid(input.trim())) return { eid: input.trim().toLowerCase() }

  let named = (await query(`.look.name~=${JSON.stringify(input.trim())}`))
    .filter((b) => nameOf(String(look(b).name ?? '')) == wanted)
  let players = [...new Set(named.map((b) => String(look(b).player ?? '')))]
    .filter(Boolean)
  if (!players.length) return null
  let current = await query(`.look.player=${players.join(',')}`)
  let latest = new Map<string, Bundle>()
  for (let row of current) {
    let p = String(look(row).player ?? '')
    let before = latest.get(p)
    if (!before || Number(look(row).at) > Number(look(before).at)) {
      latest.set(p, row)
    }
  }
  let matches = [...latest].filter(([, row]) =>
    nameOf(String(look(row).name ?? '')) == wanted
  )
  if (matches.length > 1) {
    throw new Error(`Several heroes are named ${input.trim()}; use an eid.`)
  }
  return matches.length ? { eid: matches[0][0] } : null
}
