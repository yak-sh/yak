// The gallery's browser door uses the same installation as the connector.
import { writes } from '@yaks/member'
import type { Directory, Space } from './directory.ts'
import type { Env } from './env.ts'
import { refusing } from './defects.ts'
import { createElement as h } from 'react'
import { Button, Card, Field, Form, Notice } from '@yaks/ui/parts'
import { url } from '@yaks/platform/host'
import { installAt, isBack, signInAt } from '@yaks/platform/routes'
import { whoIs } from './session.ts'
import { drawn, head } from './shell.ts'
import { call } from './tools.ts'
import { type Step, step } from './funnel.ts'
import { visitOf } from '@yaks/platform/visits'
import { ledgerOf } from './visit.ts'
import { opened, seal } from './lib/token.ts'
import { cookieValue } from '@yaks/platform/cookie'
import { fromOurs } from './page-report.ts'

export { INSTALL as PATH, installAt as at } from '@yaks/platform/routes'

let page = (
  env: Env,
  title: string,
  name: string,
  spaces: Space[],
  why = '',
  status = 200,
  selected = '',
  kept = false,
) => {
  let install = h(Button, { mod: 'go', type: 'submit' }, 'Install app')
  return drawn(
    head(
      env,
      title,
      'Get your own copy of this app.',
      url(env, installAt(name)),
      false,
    ),
    h(
      'main',
      { className: 'Page' },
      h('h1', { className: 'Title' }, title),
      why ? h(Notice, { mod: 'negative', role: 'alert' }, why) : null,
      name
        ? h(
          Card,
          { as: 'form', method: 'post', action: installAt(name) },
          h(Card.Head, null, h(Card.Title, null, 'Get your own copy')),
          h(
            Card.Sub,
            null,
            kept
              ? 'What you made in this browser comes with it, and only you can see it.'
              : 'Your copy has its own data. You can make it your own.',
          ),
          spaces.length
            ? h(
              Form.Field,
              null,
              h(Form.Label, { for: 'install-space' }, 'Install in'),
              h(
                Form.Line,
                null,
                h(
                  Field,
                  {
                    choose: true,
                    id: 'install-space',
                    name: 'space',
                    required: true,
                  },
                  spaces.map((s) =>
                    h(
                      'option',
                      { value: s.slug, selected: s.slug == selected },
                      `${s.title} (${s.slug})`,
                    )
                  ),
                ),
                install,
              ),
            )
            : h(Form.Actions, null, install),
        )
        : null,
      h('p', null, h('a', { href: '/gallery' }, 'Back to the gallery')),
    ),
    { status },
  )
}

// A stranger's press of a listing's button, kept in their browser for as long
// as signing up takes: the app it was for, sealed so no link or other site
// can make one. Back from signing in with it, nothing is left to ask, so the
// copy is made on that GET. The mark on the address (`isBack`) alone is
// anybody's to write, and installs nothing.
let PRESS = '__Host-yak_press'
let PRESS_LIFE = 30 * 60
let pressCookie = (value: string, life: number) =>
  `${PRESS}=${value}; Path=/; Max-Age=${life}; Secure; HttpOnly; SameSite=Lax`
let pressing = async (env: Env, name: string) =>
  pressCookie(
    await seal(
      'press',
      { name, exp: Math.floor(Date.now() / 1000) + PRESS_LIFE },
      env.SESSION_SECRET!,
    ),
    PRESS_LIFE,
  )
let pressed = async (req: Request, env: Env, name: string) => {
  let token = cookieValue(req.headers.get('cookie'), PRESS)
  let press = token && env.SESSION_SECRET
    ? await opened<{ name: string; exp: number }>(
      'press',
      token,
      env.SESSION_SECRET,
    )
    : null
  return press?.name == name && press.exp * 1000 > Date.now()
}
let spent = pressCookie('', 0)

let redirect = (to: string, cookie?: string) =>
  new Response(null, {
    status: 303,
    headers: { location: to, ...cookie ? { 'set-cookie': cookie } : {} },
  })

export let answer = async (req: Request, env: Env, dir: Directory) => {
  if (!['GET', 'POST'].includes(req.method)) {
    return new Response(null, { status: 405, headers: { allow: 'GET, POST' } })
  }
  let name = new URL(req.url).searchParams.get('name') ?? ''
  let offer = name ? await dir.offered(name) : null
  if (!offer?.app.published || offer.app.trashed || offer.space.trashed) {
    return page(
      env,
      'App unavailable',
      '',
      [],
      'This app is no longer available to install.',
      404,
    )
  }
  let who = await whoIs(req, env, () => Promise.resolve(null))
  // A stranger signs in on the way, and one who pressed the button (a
  // gallery listing's "Make your own copy") comes back marked, so the funnel
  // counts the press, the return and the page shown each on its own line.
  // A press from one of our own pages is kept (`PRESS`); another site's post
  // is no press of this person's.
  if (!who.person) {
    let press = req.method == 'POST'
    if (press) step(env, 'install_sign_in', req)
    return redirect(
      signInAt(url(env, installAt(name, press)), env),
      press && fromOurs(req, env) ? await pressing(env, name) : undefined,
    )
  }
  let person = who.person
  let address = await dir.emailAt(person)
  let counted = (taken: Step) => step(env, taken, req, { who: address })
  let spaces = (await dir.seats(person))
    .filter((s) => !s.space.trashed && writes(s.role)).map((s) => s.space)
  let title = `Install ${offer.app.title}`
  // What this browser made at the app before signing up (@yaks/platform/visits)
  // is the copy's, unless it already became an app.
  let visit = who.via
    ? await visitOf(ledgerOf(env), who.via, offer.app.eid)
    : null
  let kept = !!visit && !visit.adopted
  // Asked again once it became one, the install answers that app.
  let shown = (why = '', status = 200, selected = '') =>
    page(env, title, name, spaces, why, status, selected, kept)
  // Somebody signed in shown the form, by opening the page or by pressing a
  // listing's button with more than one space to choose from.
  let offered = () => {
    counted('install_form')
    return shown()
  }
  // Make the copy in `space`, or in the one app_install finds them with none
  // named, and send them into it.
  let install = async (space: string, cookie?: string) => {
    try {
      let installed = await call(
        {
          env,
          dir,
          person,
          who: {
            person,
            via: 'session',
            instrument: who.via,
            until: who.until,
          },
        },
        'app_install',
        { name, ...space ? { space } : {}, ...visit ? { visit: true } : {} },
      )
      let destination = installed.value?.url
      if (typeof destination != 'string') {
        throw new Error('Installation returned no app address')
      }
      counted('install_done')
      return redirect(destination, cookie)
    } catch (error) {
      let status = refusing(error, { request: `${req.method} /install` })
      let refused = shown(
        error instanceof Error ? error.message : String(error),
        status,
        space,
      )
      if (cookie) refused.headers.append('set-cookie', cookie)
      return refused
    }
  }
  // The space a copy goes to when nobody chose: their one, or with none the
  // one app_install makes them. With several to choose from, the form asks.
  let only = spaces.length == 1 ? spaces[0].slug : ''
  let asks = spaces.length > 1
  if (req.method == 'GET') {
    if (!isBack(new URL(req.url))) return offered()
    counted('install_back')
    // Back from signing in, the press is spent whatever happens next.
    if (!asks && await pressed(req, env, name)) return install(only, spent)
    let form = offered()
    form.headers.append('set-cookie', spent)
    return form
  }
  let form = await req.formData()
  let space = String(form.get('space') ?? '') || only
  if (!space && asks) return offered()
  return install(space)
}
