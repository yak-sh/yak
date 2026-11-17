// Stepping into a home-page demo (D-462): what a visitor who asks for their
// own change under a step of a walkthrough (walkthrough.ts) is given, read
// off the demo space's directory and its Operator's marked conversation.
// identity.ts `begun` gives it to their space.
import type { Bundle, Comp } from '@yaks/graph'
import type { Env } from './env.ts'
import type { Directory } from './directory.ts'
import { DEMO } from './gallery-demo.ts'
import { BUILDING } from './newcomer.ts'
import { TOOLS } from './tools.ts'
import { stepsOf as named } from './site/home.tsx'
import { asked, WALKED, type Walked } from './walkthrough.ts'

let comp = (b: Bundle, name: string) => b[name] as Comp | undefined

/** What a visitor stepping into a home-page demo (D-462) is given: the
 * name the demo app is published under, the release a copy of it takes, the
 * demo's lines through the step, and the tools the demo's Operator called
 * there that reach outside the app (`outside`). `step` is the step's name
 * in the home page's words (site/home.tsx `stepsOf`). None for a demo or a
 * step the page does not have, or one not recorded. */
export let walkedTo = async (
  env: Env,
  dir: Directory,
  demo: string,
  step: string,
) => {
  let at = named(demo).indexOf(step)
  let space = at < 0 ? null : await dir.space(DEMO)
  let app = space && (await dir.app(space, demo))
  if (!space || !app?.published || app.trashed) return null
  let walked: Walked | null =
    (await asked<{ walked?: Walked | null }>(env, space.eid, WALKED, {
      app: demo,
      step: at,
    })).walked ?? null
  if (!walked?.version) return null
  return {
    name: app.published.name,
    version: walked.version,
    lines: walked.lines,
    outside: outside(walked.lines),
  }
}

/**
 * The tools called in `lines` that set up something outside the app being
 * built (an alert, a number, a connection, a letter), which a copy of the
 * app does not carry: every platform tool a newcomer's Operator may not call
 * (newcomer.ts `BUILDING`), each once.
 *
 * ```ts
 * import { outside } from './stepping.ts'
 * import { assertEquals } from '@std/assert'
 * let call = (name: string) => ({ entity: { eid: name }, call: { name } })
 * assertEquals(
 *   outside(['app_deploy', 'number_buy', 'fork', 'number_buy'].map(call)),
 *   ['number_buy'],
 * )
 * ```
 */
export let outside = (lines: Bundle[]) => {
  let platform = new Set(TOOLS.map((t) => t.name))
  return [
    ...new Set(
      lines.flatMap((b) => {
        let name = String(comp(b, 'call')?.name ?? '')
        return platform.has(name) && !BUILDING.has(name) ? [name] : []
      }),
    ),
  ]
}
