// The gallery's browser door uses the same installation as the connector.
import { writes } from '@yaks/member'
import type { Directory, Space } from './directory.ts'
import type { Env } from './env.ts'
import { refusing } from './defects.ts'
import { h } from 'preact'
import { Button, Card, Field, Form, Notice } from '@yaks/ui/parts'
import { url } from '@yaks/platform/host'
import { installAt, signInAt } from '@yaks/platform/routes'
import { whoIs } from './session.ts'
import { drawn, head } from './shell.ts'
import { call } from './tools.ts'
import { step } from './funnel.ts'
import { visitOf } from './visit.ts'

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
  let who = await whoIs(req, env.SESSION_SECRET, () => Promise.resolve(null))
  let address = who.person ? await dir.emailAt(who.person) : null
  if (req.method == 'GET') step(env, 'install', req, { who: address })
  if (!who.person) {
    return Response.redirect(signInAt(url(env, installAt(name)), env), 303)
  }
  let spaces = (await dir.seats(who.person))
    .filter((s) => !s.space.trashed && writes(s.role)).map((s) => s.space)
  let title = `Install ${offer.app.title}`
  // What this browser made at the app before signing up (visit.ts) is the
  // copy's, unless it already became an app.
  let visit = who.via ? await visitOf(env, who.via, offer.app.eid) : null
  let kept = !!visit && !visit.adopted
  // Asked again once it became one, the install answers that app.
  let shown = (why = '', status = 200, selected = '') =>
    page(env, title, name, spaces, why, status, selected, kept)
  if (req.method == 'GET') return shown()
  let form = await req.formData()
  let space = String(form.get('space') ?? '') ||
    (spaces.length == 1 ? spaces[0].slug : '')
  if (!space && spaces.length > 1) return shown()
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
    step(env, 'install_done', req, { who: address })
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
