// The integration directory (T-132636, D-132633): the outside services a yaks
// app can call, at https://yaks.app/integrations, in the sitemap, and
// answerable to an agent over `integration_list`, signed in or out.
//
// Jeff, 2026-10-25: "define a Connection along with instructions on how to
// obtain a key. so i can share it with a non-technical person and they and
// their agent can work out how to get their own key. this connection could
// come with apps that depend on it, but could also be shared with others or
// published to our connection directory independently of the app."
//
// What is listed is an integration, never a connection, which holds somebody's
// credential: every built integration, and every custom one its owner listed
// (@yaks/connections `listing`). Nothing is reviewed before it is listed, as
// a gallery listing is: an entry is a few lines of text and the hosts its key
// may go to, and what its owner wrote is drawn as theirs, its links marked
// rel="nofollow ugc" (theirs.ts). Each entry adds it to a space of the
// reader's own: the connections page opened with `?add=<name>`, which offers
// it ready to paste a key or sign in (connections.ts `connectionsOf`).
import type { Listed } from '@yaks/connections'
import { keyed } from '@yaks/connections'
import { esc } from './html.ts'
import { type Host, url } from './host.ts'
import { managePath } from './route.ts'
import { foot, head, html, top } from './shell.ts'
import { drawn } from './theirs.ts'

/** The page's own words, read by seo.ts for the sitemap and llms.txt. */
export let INTEGRATIONS = {
  path: '/integrations',
  title: 'Integrations: services your yaks apps can call',
  description:
    'Outside services a yaks app can call, each with how to get its key. ' +
    'Add one to your space; yaks.app keeps the key and sends it only to the ' +
    "service's own address.",
}

/** Where a person adds an integration to a space of their own: their
 * connections page, offering it. */
export let addAt = (env: Host, name: string) =>
  url(env, `${managePath('connections')}?add=${encodeURIComponent(name)}`)

// A site is linked only at https; a custom one is its owner's word, not ours.
let site = (i: Listed) =>
  i.site && /^https:\/\/\S+$/.test(i.site)
    ? `<a href="${esc(i.site)}"${i.built ? '' : ' rel="nofollow ugc"'}>${
      esc(i.site.replace(/^https:\/\//, '').replace(/\/$/, ''))
    }</a>`
    : ''

// Its mark, as an image of its own SVG and never as markup.
let logo = (i: Listed) =>
  i.logo
    ? `<img class="Card_Mark" src="data:image/svg+xml,${
      esc(encodeURIComponent(i.logo))
    }" alt="" width="24" height="24">`
    : ''

// One service, as a card: its head the service and the way to add it, then
// what it is, where its key goes, and how to get one.
let card = async (i: Listed, env: Host) => {
  let title = i.title || i.name
  let how = await drawn(i.instructions)
  let hosts = i.hosts.map((h) => `<code>${esc(h)}</code>`).join(', ')
  let where = site(i)
  return `<li class="Card" id="${esc(encodeURIComponent(i.name))}">
<header class="Card_Head">${logo(i)}<h2 class="Card_Title">${
    esc(title)
  }</h2><div class="Card_Actions"><a class="Button" href="${
    esc(addAt(env, i.name))
  }">Add to a space</a></div></header>
${i.tagline ? `<p class="Card_Sub">${esc(i.tagline)}</p>` : ''}
<p class="Note Note-small">${where}${where && hosts ? ' · ' : ''}${
    hosts ? `Its key is only ever sent to ${hosts}.` : ''
  }</p>
${
    keyed(i)
      ? how
        ? `<details class="More"><summary>How to get the key</summary><div class="More_Body">${how}</div></details>`
        : '<p class="Note Note-small">Connected with a key you paste.</p>'
      : `<p class="Note Note-small">Connected by signing in to ${
        esc(title)
      }: there is no key to copy.</p>`
  }
</li>`
}

/** The integration directory's page: every entry, then how to add your own. */
export let page = async (all: Listed[], env: Host = {}) =>
  html(
    `${
      head(
        env,
        INTEGRATIONS.title,
        INTEGRATIONS.description,
        url(env, INTEGRATIONS.path),
      )
    }
</head>
<body>
${top}
<main class="Page">
<section class="Services" aria-labelledby="integrations">
<div class="Services_Intro">
<h1 id="integrations" class="Title">Integrations</h1>
<p class="Note">Outside services a yaks app can call. Add one to your space and your apps there can use it. yaks.app keeps the key, sends it only to the service's own address, and never hands it to an app.</p>
</div>
${
      all.length
        ? `<ul class="Services_List">${
          (await Promise.all(all.map((i) => card(i, env)))).join('')
        }</ul>`
        : '<p class="Note">Nothing is listed yet.</p>'
    }
</section>
<section class="Join Card" aria-labelledby="yours">
<h2 id="yours" class="Title">Share a service of your own</h2>
<p class="Note">On your space's connections page, add a key for any service, write how to get one, and list it here. Anyone can then add it to a space of theirs, with their own key.</p>
<p class="Join_Doors"><a class="Button" href="${
      esc(url(env, managePath('connections')))
    }">Your connections</a></p>
</section>
</main>
${foot}
</body>
</html>`,
  )

/** What `integration_list` answers: each entry found, with how to get its key
 * and how to add it. */
export let said = (all: Listed[], words: string, env: Host = {}) =>
  all.length
    ? all.map((i) =>
      [
        `${i.title || i.name} (integration: '${i.name}')${
          i.tagline ? `: ${i.tagline}` : ''
        }`,
        i.site ? `  site: ${i.site}` : '',
        `  its key is only ever sent to ${i.hosts.join(', ') || 'no host'}`,
        keyed(i)
          ? i.instructions
            ? `  how to get the key:\n${
              i.instructions.split('\n').map((l) => `    ${l}`).join('\n')
            }`
            : '  connected with a key the person pastes'
          : `  connected by signing in to ${i.title || i.name}`,
        `  add it: store_connection_need(app, integration: '${i.name}') in ` +
        `a space of theirs, or ${addAt(env, i.name)}`,
      ].filter(Boolean).join('\n')
    ).join('\n\n') +
      `\n\nThe whole directory is at ${url(env, INTEGRATIONS.path)}.`
    : words
    ? `No integration in the directory matches "${words}". A service nobody ` +
      'listed is still usable: store_connection_need with its name and the ' +
      'hosts its key may be sent to makes one.'
    : 'Nothing is listed in the integration directory yet.'
