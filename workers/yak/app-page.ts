// Each published app's own page on yaks.app (T-131911, D-131886 item 21):
// what it is, who made it, a way to open it and a way to make your own copy,
// at https://yaks.app/apps/<name> (gallery.ts `pageAt`), where <name> is the platform-wide name it
// is published under (tools.ts app_publish), the one `app_install` takes.
//
// Opening the app comes first, because a stranger who has not seen it has not
// yet decided anything; making a copy is the quieter second action, for
// someone who has looked and wants one (install.ts). It is the page the
// "Made with yaks.app" badge opens (public/badge.js).
//
// Every published app has one, listed or not, the way every published app
// already has its install page: it describes the person's own app to whoever
// they send it to, and is never on a page of ours or in a search engine until
// the gallery has listed it (gallery.ts). Unpublishing takes it away at once,
// since it reads the offers (`shown`) and is served uncached, as the install
// page is.
import { type Directory, url as appUrl } from './directory.ts'
import type { Env } from './env.ts'
import { caught } from './defects.ts'
import { pictureOf, type Shown, shown } from './gallery.ts'
import { PAGE, pageAt } from './gallery-row.ts'
import { h } from 'preact'
import { Button, Card } from '@yaks/ui/parts'
import { type Host, spaceHost } from './host.ts'
import { at as installAt } from './install.ts'
import { lost } from './pages.ts'
import { opens } from './sample.ts'
import { drawn, head } from './shell.ts'

export let page = (a: Shown, env: Host = {}) => {
  // A private app with no sample and no copy in the demo space opens only for
  // its own people, so a stranger is offered the copy and nothing to open.
  let opened = opens(a.app) || a.at != appUrl(a.space, a.app, env)
  let listed = !!a.app.gallery?.listedAt
  let shot = a.shot && (a.app.access != 'private' || listed) ? a.shot : ''
  let small = (said: string) => h('p', { class: 'Note Note-small' }, said)
  return drawn(
    head(
      env,
      `${a.title}, made with yaks.app`,
      a.about || `${a.title}, an app made with yaks.app.`,
      pageAt(a.name, env),
      listed,
    ),
    h(
      'main',
      { class: 'Page' },
      h(
        Card,
        { as: 'article', class: 'Listing', 'aria-labelledby': 'app' },
        h(
          'header',
          { class: 'Listing_Head' },
          h('h1', { id: 'app', class: 'Title' }, a.title),
          a.about ? h('p', { class: 'Note Note-lead' }, a.about) : null,
          small(`Made at ${spaceHost(env, a.space.slug)}`),
        ),
        shot
          ? h(
            'a',
            {
              class: 'Make_Shot Listing_Shot',
              href: a.at,
              tabindex: -1,
              'aria-hidden': 'true',
            },
            h('img', { src: shot, alt: '', width: 1200, height: 630 }),
          )
          : null,
        h(
          'div',
          { class: 'Listing_Doors' },
          opened ? h(Button, { mod: 'go', href: a.at }, 'Open the app') : null,
          h(
            'form',
            { method: 'post', action: installAt(a.name) },
            h(Button, { type: 'submit' }, 'Make your own copy'),
          ),
        ),
        small(
          'Your copy is yours: its own address, its own data, and the people you choose.',
        ),
      ),
      h(
        'p',
        { class: 'Note Listing_Made' },
        'Made with yaks.app, where you build an app by asking Claude or ChatGPT. ',
        h('a', { href: '/' }, 'See how it works'),
      ),
    ),
  )
}

/** The page for the app published under the name in `path`, or a 404 once
 * nothing is published under it. */
export let answer = async (
  req: Request,
  env: Env,
  path: string,
  dir: Directory,
) => {
  if (!['GET', 'HEAD'].includes(req.method)) {
    return new Response(null, { status: 405, headers: { allow: 'GET, HEAD' } })
  }
  // A published name is a slug (tools.ts app_publish), so it is its own
  // address and needs no decoding.
  let name = path.slice(PAGE.length)
  let found = name && !name.includes('/')
    ? (await shown(dir, env)).find((a) => a.name == name)
    : null
  if (!found) return lost(env)
  let shot = await pictureOf(env, found.space, found.app).catch((e) => {
    caught(e, { request: 'app page picture' })
    return ''
  })
  return page({ ...found, shot }, env)
}
