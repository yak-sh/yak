// A space's Dashboard (T-3702), at yaks.app/<space>: its apps to launch, what
// its Operator has been doing (the breaks it fixed on its own, unseen.ts
// `fix`), what it suggests (@yaks/platform/suggestions) and its Updates. It is
// a view of the Operator's frame beside its chat and Updates
// (operator-page.ts `talkPage`), and the space's own page holds its member
// parts, framed (`?framed`), under its apps (pages.ts `spaceIndex`): only
// that hostname may frame it (@yaks/platform/routes `framers`), and no app's
// code there can read it.
import { type ComponentChildren, Fragment, h } from 'preact'
import { renderToString } from 'preact-render-to-string'
import { mode } from '@yaks/member/words'
import {
  type Fix,
  type Launched,
  Launcher,
  launchFilter,
  Suggestions,
  Working,
} from '@yaks/platform/dashboard-view'
import { suggested, type Uses } from '@yaks/platform/suggestions'
import {
  backTo,
  chatPath,
  dashboardPath,
  managePath,
} from '@yaks/platform/routes'
import { spaceHost } from '@yaks/platform/host'
import type { App, Directory, Space } from './directory.ts'
import type { Env } from './env.ts'
import type { Who } from './session.ts'
import { caught } from './defects.ts'
import { run, shell } from './pages.ts'
import { redirect } from './apps.ts'
import { type Clock, clock } from './timing.ts'

/** What `space` already uses, which its suggestions leave out. */
export let usesOf = async (
  dir: Directory,
  space: Space,
  apps: App[],
): Promise<Uses> => {
  let [hosts, members] = await Promise.all([
    dir.hosts(space),
    dir.members(space),
  ])
  return {
    domain: hosts.some((host) => !host.trashed),
    people: members.length > 1,
    selling: !!space.seller,
    texts: apps.some((a) => !!a.phone),
    mail: !!space.mail,
    public: apps.some((a) => mode(a.access) == 'public'),
  }
}

/** `apps` as the launcher lists them, each opening under `at` (the space's
 * own address, or none on its own page, where a custom domain keeps them),
 * the front page at it, marking those with a fix in `fixes`. */
export let launched = (
  at: string,
  apps: App[],
  fixes: Fix[] = [],
): Launched[] =>
  apps.map((a) => ({
    eid: a.eid,
    slug: a.slug,
    title: a.title,
    source: a.source,
    generatedIcon: a.generatedIcon,
    href: `${at}/${a.home ? '' : `${a.slug}/`}`,
    visits: a.meter?.visits,
    installed: !!a.installed,
    about: a.published?.about || undefined,
    fixed: fixes.some((f) => f.app == a.eid && !f.failed),
  }))

// What failed to read leaves its part out, and is reported.
let spared = <T>(read: Promise<T>, none: T, request: string, space: Space) =>
  read.catch((e) => {
    caught(e, { request, space: space.slug })
    return none
  })

let html = (node: ComponentChildren) => renderToString(h(Fragment, null, node))

/** A space's Dashboard for `who`, a member who may write it: in the
 * Operator's frame, or `framed`, its member parts alone, for the space's own
 * page to hold. */
export let dashboardPage = async (
  env: Env,
  dir: Directory,
  space: Space,
  who: Who,
  at: {
    apps: Promise<App[]>
    side: Promise<import('./operator-page.ts').Beside>
    framed: boolean
  },
  c: Clock = clock(),
): Promise<Response> => {
  let page = await import('./operator-page.ts')
  let { fixesOf } = await import('./unseen.ts')
  let { updates, updatesOf } = await import('./updates.ts')
  let person = who.person ?? ''
  let [apps, beside, fixes, news, uses, dismissed, chat] = await Promise.all([
    at.apps,
    at.side,
    spared(fixesOf(env, space, who), [] as Fix[], 'dashboard fixes', space),
    updatesOf(env, space, who, false),
    at.apps.then((apps) => usesOf(dir, space, apps)),
    dir.dismissed(person, space.eid),
    at.framed ? undefined : page.chatBeside(env, space, who, at.side),
  ])
  let here = dashboardPath(space.slug) + (at.framed ? '?framed' : '')
  let titles = new Map(apps.map((a) => [a.eid, a.title || a.slug]))
  let offers = suggested({
    space: space.slug,
    uses,
    apps: apps.map((a) => ({ ...a, access: mode(a.access) })),
    dismissed,
  }).map((s) => ({
    ...s,
    href: s.opens
      ? managePath(s.opens, space.slug)
      : `${chatPath(space.slug)}?${new URLSearchParams({ say: s.ask ?? '' })}`,
  }))
  let parts = [
    h(Working, {
      operator: space.operator,
      fixes,
      titles,
      chat: chatPath(space.slug),
    }),
    h(Suggestions, {
      operator: space.operator,
      suggestions: offers,
      dismiss: dashboardPath(space.slug),
      back: here,
    }),
    h(
      'div',
      page.updateColumn(space, who),
      updates(
        env,
        space,
        news,
        null,
        beside.apps,
        undefined,
        undefined,
        person,
      ),
    ),
  ]
  if (at.framed) {
    return c.measure('render', () =>
      shell(
        env,
        `Dashboard · ${space.operator}`,
        null,
        200,
        html([
          h('div', { class: 'Dash Dash-framed' }, parts),
          // How tall it has grown, said to the space's page holding it,
          // and nothing else.
          run(`
let said = () => parent.postMessage({ height: document.documentElement.scrollHeight }, ${
            JSON.stringify(`https://${spaceHost(env, space.slug)}`)
          })
new ResizeObserver(said).observe(document.body)`),
        ]),
        { 'cache-control': 'private, no-store', 'x-robots-tag': 'noindex' },
        'Dashboard',
        // Every link in it opens where the space's page stood, but a
        // dismissal, which draws the frame again.
        '<base target="_top">',
      ))
  }
  let launcher = h(Launcher, {
    apps: launched(`https://${spaceHost(env, space.slug)}`, apps, fixes),
  })
  return c.measure('render', () =>
    page.talkPage(env, space, who, beside, {
      title: 'Dashboard',
      status: 200,
      waiting: news.updates.filter((u) => u.needs).length,
      listed: null,
      current: ['dashboard'],
      here: dashboardPath(space.slug),
      skip: ['#content', 'Skip to content'],
      main: h('div', { class: 'Dash' }, launcher, parts),
      // A link to the space's address from before its chat moved under
      // `/operator` named an entry by its hash, which only the browser
      // sees: it opens that conversation still.
      script: html(run(
        launchFilter + `
if (location.hash.startsWith('#row-')) location.replace(${
          JSON.stringify(chatPath(space.slug))
        } + location.hash)`,
      )),
    }, chat ? [chat] : []))
}

/** A press of a suggestion's dismissal, kept for good, then the Dashboard
 * it was pressed on. */
export let dismissAnswer = async (
  req: Request,
  env: Env,
  dir: Directory,
  space: Space,
  who: Who,
) => {
  let form = await req.formData().catch(() => new FormData())
  let name = String(form.get('dismiss') ?? '')
  if (who.person && /^[a-z-]+$/.test(name)) {
    await dir.dismiss(who.person, space.eid, name)
  }
  return redirect(
    backTo(env, String(form.get('back') ?? ''), dashboardPath(space.slug)),
    303,
  )
}
