// A space's Matches (D-453, T-160577): where its members tap between the
// sides of a round of pair matches, most often drafts of one of its apps, at
// `/<space>/matches` (@yaks/platform/routes `talkPath('matches', …)`).
// The rounds and every pick are @yaks/trial's, in the space's Operator store
// (operator-trials.ts `matching`). The page is a view over the page graph
// (@yaks/platform/operator-matches-view); this asks the store what it is
// drawn from, and serves a picture a side of a round is.
import type { Matches } from '@yaks/platform/operator-matches'
import type { Env } from './env.ts'
import type { Space } from './directory.ts'
import type { Who } from './session.ts'
import { operatorDoor } from './build-door.ts'
import { fileAnswer } from './updates.ts'

/** What the page asks the Operator's store as `who`: the rounds, one round
 * (`{round}`), a pick in one (`{round, pair, chose, why}`, answered with the
 * round as it then stands), or a picture a side of it is (`{round, side}`). */
export let matchesOf = (
  env: Env,
  space: Space,
  who: Who,
  args: Record<string, unknown> = {},
): Promise<Matches> =>
  operatorDoor(env, space, who, 'matches', args) as Promise<Matches>

/** A picture a side of a round is (`?round=<round>&side=<eid>`), undefined
 * for a read that names none. */
export let sideAnswer = async (
  req: Request,
  env: Env,
  space: Space,
  who: Who,
): Promise<Response | undefined> => {
  let q = new URL(req.url).searchParams
  if (!q.has('side')) return undefined
  let file = await operatorDoor(env, space, who, 'matches', {
    round: q.get('round') ?? '',
    side: q.get('side'),
  }).catch((e) => e?.status == 404 ? null : Promise.reject(e)) as
    | { address: string; media_type: string }
    | null
  return file
    ? fileAnswer(env, space, file, req)
    : new Response('That file is missing.', { status: 404 })
}
