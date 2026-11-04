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
import { PAGE, pageAt, pictures, type Shown, shown } from './gallery.ts'
import { esc } from './html.ts'
import { type Host, spaceHost } from './host.ts'
import { at as installAt } from './install.ts'
import { lost } from './pages.ts'
import { opens } from './sample.ts'
import { foot, head, html, top } from './shell.ts'

export let page = (a: Shown, env: Host = {}) => {
  // A private app with no sample and no copy in the demo space opens only for
  // its own people, so a stranger is offered the copy and nothing to open.
  let opened = opens(a.app) || a.at != appUrl(a.space, a.app, env)
  let listed = !!a.app.gallery?.listedAt
  let shot = a.shot && (a.app.access != 'private' || listed) ? a.shot : ''
  let copy = `<form method="post" action="${
    esc(installAt(a.name))
  }"><button class="Button Button-quiet" type="submit">Make your own copy</button></form>`
  return html(
    `${
      head(
        env,
        `${a.title}, made with yaks.app`,
        a.about || `${a.title}, an app made with yaks.app.`,
        pageAt(a.name, env),
        listed,
      )
    }
</head>
<body>
${top}
<main class="Page">
<article class="Card Listing" aria-labelledby="app">
<header class="Listing_Head">
<h1 id="app" class="Title">${esc(a.title)}</h1>
${a.about ? `<p class="Note Note-lead">${esc(a.about)}</p>` : ''}
<p class="Note Note-small">Made at ${esc(spaceHost(env, a.space.slug))}</p>
</header>
${
      shot
        ? `<a class="Make_Shot Listing_Shot" href="${
          esc(a.at)
        }" tabindex="-1" aria-hidden="true"><img src="${
          esc(shot)
        }" alt="" width="1200" height="630"></a>`
        : ''
    }
<div class="Listing_Doors">${
      opened
        ? `<a class="Button" href="${esc(a.at)}">Open the app</a>${copy}`
        : copy
    }</div>
<p class="Note Note-small">Your copy is yours: its own address, its own data, and the people you choose.</p>
</article>
<p class="Note Listing_Made">Made with yaks.app, where you build an app by asking Claude or ChatGPT. <a href="/">See how it works</a></p>
</main>
${foot}
</body>
</html>`,
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
  let [a] = await pictures(env, [found])
  return page(a, env)
}
