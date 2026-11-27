// Who an app's model call is for, read from its transcript in the app's store
// (meter.ts `Whose`).
import type { Comp } from '@yaks/graph'
import { type Level, writes } from '@yaks/member'
import { grantEid } from '@yaks/platform/app-writes'
import type { Whose } from './meter.ts'
import type { Stored } from './graph.ts'

/**
 * The person whose work a call on `transcript` is, and the visitor whose share
 * of the space's budget it spends (@yaks/platform/meter `visiting`) and their
 * calls of the day (@yaks/platform/meter `visitorCalls`), if it is a visitor's.
 *
 * The turn is the transcript's starter's, since a visitor writes lines only in
 * transcripts they started (app-authority.ts `WITHIN`). One signed in is its
 * person. Only an app whose manifest opens its models has visitor turns:
 * elsewhere `using` is an editor's to write (app-authority.ts `FLOORS`). There,
 * the starter is a visitor unless it is someone whose vouched level here writes
 * (app-writes.ts `vouching` keeps it); nobody signed in is a visitor too, named
 * by the transcript, since the store never learns their address. A transcript
 * nobody wrote, not even through a browser's vouched via, or the app wrote
 * itself, is the app's own automation (a scheduled call's): no person's, and
 * spent as a member's.
 */
export let whoseOf = async (
  at: Stored,
  transcript?: string,
): Promise<Whose> => {
  if (!transcript) return {}
  let [session] = await at.graph.get([transcript])
  let { by, via } = (session?.created ?? {}) as Comp
  let open = at.manifest().models == 'open'
  if (typeof by != 'string') return open && via ? { visitor: transcript } : {}
  if (by == at.app) return {}
  if (!open) return { person: by }
  let [grant] = await at.graph.get([grantEid(at.app!, by)])
  return writes((grant?.grant as Comp | undefined)?.access as Level)
    ? { person: by }
    : { visitor: by, person: by }
}
