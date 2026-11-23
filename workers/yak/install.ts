// The gallery's browser door uses the same installation as the connector.
import { writes } from '@yaks/member'
import type { Directory, Space } from './directory.ts'
import type { Env } from './env.ts'
import { refusing } from './defects.ts'
import { h } from 'preact'
import { Button, Card, Field, Form, Notice } from '@yaks/ui/parts'
import { url } from '@yaks/platform/host'
import { installAt, isBack, signInAt } from '@yaks/platform/routes'
import { whoIs } from './session.ts'
import { drawn, head } from './shell.ts'
import { call } from './tools.ts'
import { type Step, step } from './funnel.ts'
import { visitOf } from '@yaks/platform/visits'
import { ledgerOf } from './visit.ts'

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
      { class: 'Page' },
      h('h1', { class: 'Title' }, title),
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
  if (!who.person) {
    let pressed = req.method == 'POST'
    if (pressed) step(env, 'install_sign_in', req)
    return Response.redirect(
      signInAt(url(env, installAt(name, pressed)), env),
      303,
    )
  }
  let address = await dir.emailAt(who.person)
  let counted = (taken: Step) => step(env, taken, req, { who: address })
  let spaces = (await dir.seats(who.person))
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
  if (req.method == 'GET') {
    if (isBack(new URL(req.url))) counted('install_back')
    return offered()
  }
  let form = await req.formData()
  let space = String(form.get('space') ?? '') ||
    (spaces.length == 1 ? spaces[0].slug : '')
  if (!space && spaces.length > 1) return offered()
  try {
    let installed = await call(
      {
        env,
        dir,
        person: who.person,
        who: {
          person: who.person,
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
    return Response.redirect(destination, 303)
  } catch (error) {
    let status = refusing(error, { request: 'POST /install' })
    return shown(
      error instanceof Error ? error.message : String(error),
      status,
      space,
    )
  }
}
