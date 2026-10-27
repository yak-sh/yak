// The gallery's browser door uses the same installation as the connector.
import { writes } from '@yaks/member'
import type { Directory, Space } from './directory.ts'
import type { Env } from './env.ts'
import { refusing } from './defects.ts'
import { esc } from './html.ts'
import { url } from './host.ts'
import { signInAt } from './route.ts'
import { whoIs } from './session.ts'
import { foot, head, html, top } from './shell.ts'
import { call } from './tools.ts'

export let PATH = '/install'
export let at = (name: string) => `${PATH}?name=${encodeURIComponent(name)}`

let page = (
  env: Env,
  title: string,
  name: string,
  spaces: Space[],
  why = '',
  status = 200,
  selected = '',
) =>
  html(
    `${
      head(
        env,
        title,
        'Get your own copy of this app.',
        url(env, at(name)),
        false,
      )
    }
</head><body>
${top}
<main class="Page">
<h1 class="Title">${esc(title)}</h1>
${why ? `<p class="Say Say-no" role="alert">${esc(why)}</p>` : ''}
${
      name
        ? `<form class="Card" method="post" action="${esc(at(name))}">
<header class="Card_Head"><h2 class="Card_Title">Get your own copy</h2></header>
<p class="Card_Sub">Your copy has its own data. You can make it your own.</p>
${
          spaces.length
            ? `<div class="Form_Field"><label class="Form_Label" for="install-space">Install in</label><div class="Form_Line"><select class="Field" id="install-space" name="space" required>${
              spaces.map((s) =>
                `<option value="${esc(s.slug)}"${
                  s.slug == selected ? ' selected' : ''
                }>${esc(s.title)} (${esc(s.slug)})</option>`
              ).join('')
            }</select><button class="Button" type="submit">Install app</button></div></div>`
            : '<div class="Form_Actions"><button class="Button" type="submit">Install app</button></div>'
        }
</form>`
        : ''
    }
<p><a href="/gallery">Back to the gallery</a></p>
</main>
${foot}
</body></html>`,
    status,
  )

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
  if (!who.person) {
    return Response.redirect(signInAt(url(env, at(name)), env), 303)
  }
  let spaces = (await dir.seats(who.person))
    .filter((s) => !s.space.trashed && writes(s.role)).map((s) => s.space)
  let title = `Install ${offer.app.title}`
  if (req.method == 'GET') return page(env, title, name, spaces)
  let form = await req.formData()
  let space = String(form.get('space') ?? '') ||
    (spaces.length == 1 ? spaces[0].slug : '')
  if (!space && spaces.length > 1) return page(env, title, name, spaces)
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
      { name, ...space ? { space } : {} },
    )
    let destination = installed.value?.url
    if (typeof destination != 'string') {
      throw new Error('Installation returned no app address')
    }
    return Response.redirect(destination, 303)
  } catch (error) {
    let status = refusing(error, { request: 'POST /install' })
    return page(
      env,
      title,
      name,
      spaces,
      error instanceof Error ? error.message : String(error),
      status,
      space,
    )
  }
}
