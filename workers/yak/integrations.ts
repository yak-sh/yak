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
// reader's own: the connections page opened with `#<name>`, which offers
// it ready to paste a key or sign in (connections.ts `connectionsOf`).
import type { Listed } from '@yaks/connections'
import { keyed } from '@yaks/connections'
import { type ComponentChildren, h } from 'preact'
import { Button, Card, More } from '@yaks/ui/parts'
import { raw } from './html.ts'
import { type Host, url } from './host.ts'
import { managePath } from './route.ts'
import { drawn, head } from './shell.ts'
import { drawn as theirs } from './theirs.ts'

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
  url(env, `${managePath('connections')}#${encodeURIComponent(name)}`)

// A site is linked only at https; a custom one is its owner's word, not ours.
let site = (i: Listed) =>
  i.site && /^https:\/\/\S+$/.test(i.site)
    ? h(
      'a',
      { href: i.site, rel: i.built ? undefined : 'nofollow ugc' },
      i.site.replace(/^https:\/\//, '').replace(/\/$/, ''),
    )
    : null

// Its mark, as an image of its own SVG and never as markup.
let logo = (i: Listed) =>
  i.logo
    ? h(Card.Mark, {
      as: 'img',
      src: `data:image/svg+xml,${encodeURIComponent(i.logo)}`,
      alt: '',
      width: 24,
      height: 24,
    })
    : null

let small = (...said: ComponentChildren[]) =>
  h('p', { class: 'Note Note-small' }, ...said)

// Its hosts, each as code, a comma between.
let hostsOf = (i: Listed) =>
  i.hosts.flatMap((at, n) => [n ? ', ' : null, h('code', null, at)])

// One service, as a card: its head the service and the way to add it, then
// what it is, where its key goes, and how to get one. How to get its key is
// its owner's Markdown, drawn as theirs (theirs.ts).
let card = async (i: Listed, env: Host) => {
  let title = i.title || i.name
  let how = await theirs(i.instructions)
  let where = site(i)
  return h(
    Card,
    { as: 'li', id: encodeURIComponent(i.name) },
    h(
      Card.Head,
      null,
      logo(i),
      h(Card.Title, null, title),
      h(
        Card.Actions,
        null,
        h(Button, { mod: 'go', href: addAt(env, i.name) }, 'Add to a space'),
      ),
    ),
    i.tagline ? h(Card.Sub, null, i.tagline) : null,
    small(
      where,
      where && i.hosts.length ? ' · ' : null,
      i.hosts.length
        ? ['Its key is only ever sent to ', hostsOf(i), '.']
        : null,
    ),
    i.service
      ? small(
        'Connect selected service operations. Purchases require a separate checkout or explicit purchase authority.',
      )
      : keyed(i)
      ? how
        ? h(
          More,
          null,
          h(More.Summary, null, 'How to get the key'),
          h(More.Body, null, raw(how)),
        )
        : small('Connected with a key you paste.')
      : small(`Connected by signing in to ${title}: there is no key to copy.`),
  )
}

/** The integration directory's page: every entry, then how to add your own. */
export let page = async (all: Listed[], env: Host = {}) =>
  drawn(
    head(
      env,
      INTEGRATIONS.title,
      INTEGRATIONS.description,
      url(env, INTEGRATIONS.path),
    ),
    h(
      'main',
      { class: 'Page' },
      h(
        'section',
        { class: 'Services', 'aria-labelledby': 'integrations' },
        h(
          'div',
          { class: 'Services_Intro' },
          h('h1', { id: 'integrations', class: 'Title' }, 'Integrations'),
          h(
            'p',
            { class: 'Note' },
            "Outside services a yaks app can call. Add one to your space and your apps there can use it. yaks.app keeps the key, sends it only to the service's own address, and never hands it to an app.",
          ),
        ),
        all.length
          ? h(
            'ul',
            { class: 'Services_List' },
            await Promise.all(all.map((i) => card(i, env))),
          )
          : h('p', { class: 'Note' }, 'Nothing is listed yet.'),
      ),
      h(
        Card,
        { class: 'Join', 'aria-labelledby': 'yours' },
        h('h2', { id: 'yours', class: 'Title' }, 'Share a service of your own'),
        h(
          'p',
          { class: 'Note' },
          "On your space's Connections page, add a key for any service, write how to get one, and list it here. Anyone can then add it to a space of theirs, with their own key.",
        ),
        h(
          'p',
          { class: 'Join_Doors' },
          h(
            Button,
            { mod: 'go', href: url(env, managePath('connections')) },
            'Your connections',
          ),
        ),
      ),
    ),
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
        i.description ? `  service: ${i.description}` : '',
        i.details ? `  integration: ${i.details}` : '',
        i.site ? `  site: ${i.site}` : '',
        i.docs ? `  docs: ${i.docs}` : '',
        i.categories?.length ? `  categories: ${i.categories.join(', ')}` : '',
        i.connects ? `  connects: ${i.connects}` : '',
        i.broker ? `  through: ${i.broker.name}` : '',
        i.unchecked
          ? '  unchecked: this catalog entry has not been verified'
          : '',
        i.service
          ? `  app: ${i.service.app}; selected operations only, no store membership`
          : `  its key is only ever sent to ${i.hosts.join(', ') || 'no host'}`,
        i.service
          ? '  connect selected operations; purchases require checkout or explicit purchase authority'
          : keyed(i)
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
