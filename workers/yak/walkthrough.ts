// A recorded walkthrough (D-462): a conversation with the demo space's
// Operator marked walkthrough{app}, which yaks.app's home page shows beside
// the app it built (site/home.tsx `Walkthrough`). Each of the person's
// requests is a step, and a step ends in the release its last app_deploy of
// the app made, or in the one before it when it released nothing (a step done
// outside the app, a subscription the Operator set), so a recorder marks the
// conversation and nothing else: the transcript says where each step ends and
// which version it left the app at.
//
// Only what was said leaves the demo space (`said`): each step's request and
// the Operator's reply. A transcript also holds the space's own data (its
// contacts, its apps, the pages its Operator read), which stays there.
//
// The Builder object draws each step's lines as the chat page draws them
// (operator-host.ts `walkthroughOf`); the page is filled with them as it is
// served (gallery.ts `made`), each step beside the picture of its release
// (gallery.ts `shotAt`).
import type { Bundle, Comp } from '@yaks/graph'
import { theirs, words } from '@yaks/session/conversation'
import { toolEid } from '@yaks/tools/result'
import type { Env } from './env.ts'
import { builderOf, SPACE } from './build-door.ts'
import { keptValue } from './results.ts'
import { sourceWords } from './operator-source.ts'

/** Where the kernel asks a space's object for a walkthrough (build.ts). */
export let WALKTHROUGH = '/operator/walkthrough'

/** Where it asks for a walkthrough's lines through a step, for a visitor
 * stepping in (operator-host.ts `walkedOf`). */
export let WALKED = '/operator/walked'

/** One step of a walkthrough as it leaves the demo space (`said`): what was
 * said in it, the person's request first, the names of the tools it called,
 * and the version it left the app at, if any step so far released one. */
export type Step = { lines: Bundle[]; called: string[]; version: number | null }

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

// A request of the person's: their own words, not the system's.
let request = (b: Bundle) => theirs(b) && !b.system

// What leaves the demo space of a line that was said: its words and where it
// sits, nothing else it carries.
let bare = (b: Bundle, body: string, rest: Bundle = {} as Bundle): Bundle => ({
  ...rest,
  entity: { eid: b.entity.eid },
  entry: {
    session: String(comp(b, 'entry')?.session ?? ''),
    seq: Number(comp(b, 'entry')?.seq ?? 0),
  },
  content: { body },
})

/**
 * What was said in a step's lines, the only lines of a marked conversation
 * that leave the demo space: the request in the person's exact words, without
 * the note a channel adds to them (operator-source.ts `sourceWords`), and the
 * Operator's reply to it, its last words in the step. Not a call, a result,
 * a prompt, a progress line, recalled memories, reasoning or words it wrote
 * mid-work: a kind of line nobody thought of stays behind too.
 *
 * ```ts
 * import { said } from './walkthrough.ts'
 * import { assertEquals } from '@std/assert'
 * let at = (seq: number, rest: object) => ({
 *   entity: { eid: `e${seq}` }, entry: { session: 's', seq }, ...rest,
 * })
 * let lines = said([
 *   at(1, { content: { body: 'A guestbook' }, created: { by: 'ada' } }),
 *   at(2, { prompt: { scope: 'local' }, content: { body: 'Ada said before' } }),
 *   at(3, { output: { source: 'a' }, content: { body: 'Looking.' } }),
 *   at(4, { call: { name: 'contact_list' } }),
 *   at(5, { result: { call: 'e4' }, content: { body: 'ada@example.com' } }),
 *   at(6, { output: { source: 'b' }, content: { body: 'Done.' } }),
 * ])
 * assertEquals(lines.map((b) => b.content), [
 *   { body: 'A guestbook' },
 *   { body: 'Done.' },
 * ])
 * assertEquals(Object.keys(lines[0]), ['entity', 'entry', 'content'])
 * ```
 */
export let said = (lines: Bundle[]): Bundle[] => {
  let asked = lines.find(request)
  let reply = lines.findLast((b) =>
    b.output && String(comp(b, 'content')?.body ?? '').trim()
  )
  return [
    ...asked
      ? [bare(asked, sourceWords(words(String(comp(asked, 'content')!.body))))]
      : [],
    ...reply
      ? [bare(reply, String(comp(reply, 'content')!.body), {
        output: {},
      } as unknown as Bundle)]
      : [],
  ]
}

/**
 * The steps of a conversation's entries, in order, each as it leaves the
 * demo space (`said`): each begins at a request of the person's and ends
 * before the next. Lines before the first request are no step's. A step's
 * version is its last release of the app, or the step before's when it
 * released nothing, and none until a step has.
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
 *   at(2, { call: { to: toolEid('app_deploy'), name: 'app_deploy', args: { app: 'guestbook' } } }),
 *   at(3, { result: { call: 'e2', value: { deployed: true, version: 1 } } }),
 *   at(4, { output: {}, content: { body: 'Done.' } }),
 *   at(5, { content: { body: 'Text me when someone signs' } }),
 *   at(6, { call: { name: 'subscription_set', args: {} } }),
 * ], 'guestbook')
 * assertEquals(
 *   steps.map((s) => [s.lines.length, s.called, s.version]),
 *   [[2, ['app_deploy'], 1], [1, ['subscription_set'], 1]],
 * )
 * ```
 */
export let stepsOf = (entries: Bundle[], app: string): Step[] => {
  let ordered = [...entries].sort((a, b) =>
    Number(comp(a, 'entry')?.seq ?? 0) - Number(comp(b, 'entry')?.seq ?? 0)
  )
  let released = new Map<string, number>()
  for (let b of ordered) {
    let r = comp(b, 'result')
    // Kept as the Operator keeps every result (results.ts `resultValue`).
    let value = keptValue(r?.value)
    if (r?.call && value?.deployed && typeof value.version == 'number') {
      released.set(String(r.call), value.version)
    }
  }
  let steps: { lines: Bundle[]; version: number | null }[] = []
  for (let b of ordered) {
    if (request(b)) {
      steps.push({ lines: [], version: steps.at(-1)?.version ?? null })
    }
    let step = steps.at(-1)
    if (!step) continue
    step.lines.push(b)
    let version = deploys(b, app) ? released.get(b.entity.eid) : undefined
    if (version != null) step.version = version
  }
  return steps.map(({ lines, version }) => ({
    lines: said(lines),
    called: [
      ...new Set(lines.flatMap((b) => {
        let name = comp(b, 'call')?.name
        return name ? [String(name)] : []
      })),
    ],
    version,
  }))
}

/** A walkthrough through one of its steps: what was said up to that step's
 * end (`said`), the tools called up to it by name, and the version of the
 * app as that step left it. */
export type Walked = {
  lines: Bundle[]
  called: string[]
  version: number | null
}

/** A kernel request to the demo space's object. */
export let asked = async <T>(
  env: Env,
  space: string,
  path: string,
  body: object,
) => {
  let answer = await builderOf(env, space)(() =>
    new Request(`https://builder${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-yak-kernel': '1',
        [SPACE]: space,
      },
      body: JSON.stringify(body),
    })
  )
  if (!answer.ok) {
    throw new Error(`${path} was not answered (${answer.status})`)
  }
  return await answer.json() as T
}

/** A step of a home-page demo somebody stepped into (identity.ts
 * `steppedIn`): the demo app's published name, the step's title, the copy
 * of the app in their space, the tools the demo called that reach outside
 * the app, and whether their conversation began with the demo's lines
 * (operator.ts `begunWith`) or is one they already had. */
export type Stepped = {
  demo: string
  step: string
  app: string
  outside?: string[]
  begun: boolean
}

/** What the Operator is told before a person's words given from a step of a
 * home-page demo (operator-channels.ts `BY`). */
export let STEPPING = (stepped: Stepped) =>
  (stepped.begun
    ? `The conversation so far is yaks.app's demo of ${stepped.demo}, recorded in yaks.app's demo space and shown on its home page. A visitor stepped into it at this point, and these are their first words: they want the app as their own, changed as they ask.`
    : `These words come from yaks.app's home page, where this person stepped into its demo of ${stepped.demo} at the step "${stepped.step}": they want the app as their own, changed as they ask. The demo's conversation is not in this one.`) +
  ` This space has its own copy of the app as the demo had it ${
    stepped.begun ? 'here' : 'at that step'
  }, at ${stepped.app}; change that copy, not the demo's.` +
  (stepped.outside?.length
    ? ` What the demo's Operator set up outside the app is not here (it called ${
      stepped.outside.join(', ')
    }): offer to set each up for them when it fits what they ask, and a space nobody has kept yet asks for their email first.`
    : '') +
  '\n\n'

/** The demo space's walkthrough of `app`, drawn, or none while nobody has
 * marked one. */
export let walkthroughAt = async (
  env: Env,
  space: string,
  app: string,
): Promise<Walkthrough | null> => {
  let { walkthrough } = await asked<{ walkthrough?: Walkthrough | null }>(
    env,
    space,
    WALKTHROUGH,
    { app },
  )
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
 * A home page as served (gallery.ts `made`, `walks`): each app its file walks
 * through whose conversation is recorded, every step of it with its exchange
 * and the picture of its release, has them filled in, and its card leaves the
 * carousel (`data-demo`), since the page already shows it; an app without is
 * cut, with its name and the links to it, and the whole walkthrough while no
 * app is left.
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
    out = cut(out, 'li', ` data-demo="${app}"`)
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
