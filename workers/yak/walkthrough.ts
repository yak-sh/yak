// A recorded walkthrough (D-462): a conversation with the demo space's
// Operator marked walkthrough{app}, which yaks.app's home page shows beside
// the app it built (site/home.tsx `Walkthrough`). Each of the person's
// requests is a step, and a step ends in the release its last app_deploy of
// the app made, so a recorder marks the conversation and nothing else: the
// transcript says where each step ends and which version it released.
//
// The Builder object draws each step's lines as the chat page draws them
// (operator-host.ts `walkthroughOf`); the page is filled with them as it is
// served (gallery.ts `made`), each step beside the picture of its release
// (gallery.ts `shotAt`).
import type { Bundle, Comp } from '@yaks/graph'
import { theirs } from '@yaks/session/conversation'
import { toolEid } from '@yaks/tools/result'
import type { Env } from './env.ts'
import { builderOf, SPACE } from './build-door.ts'

/** Where the kernel asks a space's object for a walkthrough (build.ts). */
export let WALKTHROUGH = '/operator/walkthrough'

/** One step of a walkthrough: its lines, the person's request first, and the
 * version its last release of the app made, if it made one. */
export type Step = { lines: Bundle[]; version: number | null }

/** A walkthrough as its object answers it: each step's lines drawn as HTML. */
export type Walkthrough = {
  session: string
  steps: { html: string; version: number | null }[]
}

let comp = (b: Bundle, name: string) => b[name] as Comp | undefined

let DEPLOY = toolEid('app_deploy')

// Whether a call released `app`: its tool is app_deploy, named by its app's
// slug alone or as space/app.
let deploys = (b: Bundle, app: string) => {
  let call = comp(b, 'call')
  if (!call || (call.to != DEPLOY && call.name != 'app_deploy')) return false
  let named = String((call.args as Record<string, unknown>)?.app ?? '')
  return named == app || named.endsWith(`/${app}`)
}

/**
 * The steps of a conversation's entries, in order: each begins at a request
 * of the person's and holds every line before the next but what the Operator
 * sent its model (`ask`). Lines before the first request are no step's.
 *
 * ```ts
 * import { stepsOf } from './walkthrough.ts'
 * import { toolEid } from '@yaks/tools/result'
 * import { assertEquals } from '@std/assert'
 * let at = (seq: number, rest: object) => ({
 *   entity: { eid: `e${seq}` }, entry: { session: 's', seq }, ...rest,
 * })
 * let steps = stepsOf([
 *   at(1, { content: { body: 'A guestbook' } }),
 *   at(2, { call: { to: toolEid('app_deploy'), args: { app: 'guestbook' } } }),
 *   at(3, { result: { call: 'e2', value: { deployed: true, version: 1 } } }),
 *   at(4, { output: {}, content: { body: 'Done.' } }),
 *   at(5, { content: { body: 'Add photos' } }),
 * ], 'guestbook')
 * assertEquals(steps.map((s) => [s.lines.length, s.version]), [[4, 1], [1, null]])
 * ```
 */
export let stepsOf = (entries: Bundle[], app: string): Step[] => {
  let ordered = [...entries].sort((a, b) =>
    Number(comp(a, 'entry')?.seq ?? 0) - Number(comp(b, 'entry')?.seq ?? 0)
  )
  let released = new Map<string, number>()
  for (let b of ordered) {
    let r = comp(b, 'result')
    let value = r?.value as { deployed?: boolean; version?: number } | null
    if (r?.call && value?.deployed && typeof value.version == 'number') {
      released.set(String(r.call), value.version)
    }
  }
  let steps: Step[] = []
  for (let b of ordered) {
    // What the Operator sent its model is its own, not the exchange.
    if (b.ask) continue
    if (theirs(b)) steps.push({ lines: [], version: null })
    let step = steps.at(-1)
    if (!step) continue
    step.lines.push(b)
    let version = deploys(b, app) ? released.get(b.entity.eid) : undefined
    if (version != null) step.version = version
  }
  return steps
}

/** The demo space's walkthrough of `app`, drawn, or none while nobody has
 * marked one. */
export let walkthroughAt = async (
  env: Env,
  space: string,
  app: string,
): Promise<Walkthrough | null> => {
  let answer = await builderOf(env, space)(() =>
    new Request(`https://builder${WALKTHROUGH}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-yak-kernel': '1',
        [SPACE]: space,
      },
      body: JSON.stringify({ app }),
    })
  )
  if (!answer.ok) {
    throw new Error(`the walkthrough of ${app} was not read (${answer.status})`)
  }
  let { walkthrough } = await answer.json() as {
    walkthrough?: Walkthrough | null
  }
  return walkthrough ?? null
}

/** A step as the served page shows it: its lines drawn, and the address of
 * the picture of the release it ended in. */
export type Shown = { html: string; shot: string }

/** The apps a page's file walks through, each by its `data-walk`. */
export let walking = (file: string) =>
  [...file.matchAll(/ data-walk="([\w-]+)"/g)].map((m) => m[1])

// The steps a page's file has of an app, by their `data-walk-talk`.
let stepsIn = (file: string, app: string) =>
  [...file.matchAll(new RegExp(` data-walk-talk="${app}/([\\w-]+)"`, 'g'))]
    .map((m) => m[1])

// The file without the element `tag` that holds `marker` in its opening tag,
// each time it does; an element of that tag holds no other.
let cut = (file: string, tag: string, marker: string): string => {
  let at = file.indexOf(marker)
  if (at < 0) return file
  let from = file.lastIndexOf(`<${tag}`, at)
  let to = file.indexOf(`</${tag}>`, at)
  if (from < 0 || to < 0) return file
  return cut(file.slice(0, from) + file.slice(to + tag.length + 3), tag, marker)
}

// What fills an element the file left empty for it.
let fill = (file: string, open: string, close: string, inner: string) =>
  file.replace(`${open}>${close}`, `${open}>${inner}${close}`)

/**
 * A home page as served (gallery.ts `made`, `walks`): each app its file walks through
 * whose conversation is recorded, every step of it with its exchange and the
 * picture of its release, has them filled in; an app without is cut, with its
 * name and the links to it, and the whole walkthrough while no app is left.
 */
export let walkedInto = (file: string, shown: Record<string, Shown[]>) => {
  let out = file
  for (let app of walking(file)) {
    let steps = stepsIn(out, app)
    let had = shown[app] ?? []
    if (!steps.length || steps.some((_, i) => !had[i]?.shot)) {
      out = cut(out, 'article', ` data-walk="${app}"`)
      out = cut(out, 'p', ` data-walk-next="${app}"`)
      out = cut(out, 'button', ` data-walk-name="${app}"`)
      continue
    }
    steps.forEach((step, i) => {
      let at = `${app}/${step}`
      out = fill(out, ` data-walk-talk="${at}"`, '</div>', had[i].html)
      out = fill(
        out,
        ` data-walk-shot="${at}"`,
        '</span>',
        `<img class="Walk_Image" src="${escaped(had[i].shot)}" alt="" ` +
          'loading="lazy" width="1280" height="900">',
      )
    })
  }
  return walking(out).length ? out : cut(out, 'section', ' data-walks')
}

let escaped = (s: string) =>
  s.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;')
