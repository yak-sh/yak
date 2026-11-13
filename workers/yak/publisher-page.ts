// A publisher's public page on yaks.app (D-160631, T-160644), at
// https://yaks.app/spaces/<slug>: everything the space has shared, each with
// what yaks.app says of it, the installs across all of it, and the space's own
// web address.
//
// It shows what is already public: the apps the gallery listed (gallery.ts),
// the skills yaks.app reviewed and listed (skill-page.ts), and the
// integrations the space listed in the integration directory
// (integrations.ts). A space that shares none of these has no page, so the
// address of a space that keeps to itself answers as nothing published.
//
// Its web address is a domain the space attached and verified for itself
// (domains.ts), or else its own subdomain. The installs are counted when the
// page is read, never stored, the way each listing counts its own
// (gallery-row.ts `reputation`).
import {
  type Directory,
  NO_UPTAKE,
  type SkillOffer,
  type Space,
} from './directory.ts'
import type { Env } from './env.ts'
import { card, listed, type Shown } from './gallery.ts'
import {
  pageAt,
  PUBLISHER,
  publisherAt,
  type Reputation,
  reputation,
  reputationOf,
} from './gallery-row.ts'
import { type Rated, rating } from './integrations.ts'
import { paged, skillAt } from './skill-page.ts'
import { type ComponentChildren, h } from 'preact'
import { Card } from '@yaks/ui/parts'
import { type Host, spaceHost, url as siteUrl } from '@yaks/platform/host'
import { lost } from './pages.ts'
import { drawn, head } from './shell.ts'

/** A skill as its publisher's page lists it. */
export type SharedSkill = { skill: SkillOffer; reputation: Reputation }

/** Everything one space has shared in public, each with its reputation. */
export type Published = {
  space: Space
  apps: Shown[]
  skills: SharedSkill[]
  integrations: Rated[]
  /** the domains it attached and verified for itself, oldest first */
  domains: string[]
}

/** Whether a space has anything shared in public, and so a page. */
export let shares = (p: Published) =>
  p.apps.length + p.skills.length + p.integrations.length > 0

/** How many other spaces installed anything the space shared. */
export let installed = (p: Published) =>
  [...p.apps, ...p.skills, ...p.integrations]
    .reduce((n, s) => n + (s.reputation?.installs ?? 0), 0)

/** The space's own web address: a domain it attached, or its subdomain. */
export let addressOf = (p: Published, env: Host = {}) =>
  p.domains[0] ?? spaceHost(env, p.space.slug)

/** What `space` has shared in public, read from the directory. */
export let publishedBy = async (
  dir: Directory,
  space: Space,
  env: Host = {},
): Promise<Published> => {
  let [apps, skills, integrations, hosts] = await Promise.all([
    listed(dir, env).then((all) => all.filter((a) => a.space.eid == space.eid)),
    paged(dir).then((all) => all.filter((s) => s.space.eid == space.eid)),
    dir.integrations().then((all) =>
      rating(dir, all.filter((i) => i.owner == space.eid))
    ),
    dir.hosts(space),
  ])
  let counted = await dir.uptakes(
    skills.map((s) => ({ of: s.skill.eid, maker: space.eid })),
  )
  return {
    space,
    apps,
    skills: skills.map(({ skill }) => ({
      skill,
      reputation: reputation(
        skill,
        counted.get(skill.eid) ?? NO_UPTAKE,
        space,
      ),
    })),
    integrations,
    domains: hosts
      .filter((d) => d.serves == space.eid && d.verified && d.stage == 'active')
      .map((d) => d.name),
  }
}

/** Every page drawn from the directory, for the sitemap (seo.ts): each
 * listed app's, each listed skill's, and each publisher's. */
export let addresses = async (dir: Directory, env: Host = {}) => {
  let [apps, skills, integrations] = await Promise.all([
    listed(dir, env),
    paged(dir),
    dir.integrations(),
  ])
  let owners = new Set(integrations.flatMap((i) => i.owner ?? []))
  let spaces = new Map<string, string>([
    ...apps.map((a) => [a.space.eid, a.space.slug] as const),
    ...skills.map((s) => [s.space.eid, s.space.slug] as const),
  ])
  for (let eid of owners) {
    if (spaces.has(eid)) continue
    let space = await dir.at(eid)
    if (space && !space.trashed) spaces.set(eid, space.slug)
  }
  return [
    ...apps.map((a) => pageAt(a.name, env)),
    ...skills.map((s) => skillAt(s.skill.published.name, env)),
    ...[...spaces.values()].map((slug) => publisherAt(slug, env)),
  ]
}

let note = (...said: ComponentChildren[]) => h('p', { class: 'Note' }, ...said)
let small = (...said: ComponentChildren[]) =>
  h('p', { class: 'Note Note-small' }, ...said)
let times = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n == 1 ? one : many}`

// A skill or an integration as a card: its name, linked to where it is
// listed, what it is, and what yaks.app says of it.
let item = (
  title: string,
  href: string,
  about: string,
  said: ComponentChildren,
) =>
  h(
    Card,
    { as: 'li' },
    h(
      Card.Head,
      null,
      h(Card.Title, { as: 'h3' }, h(Card.Link, { href }, title)),
    ),
    about ? h(Card.Sub, null, about) : null,
    said,
  )

let section = (id: string, title: string, list: ComponentChildren) =>
  h(
    'section',
    { class: 'Publisher_Part', 'aria-labelledby': id },
    h('h2', { id }, title),
    list,
  )

/** The publisher's page. */
export let page = (p: Published, env: Host = {}) => {
  let { space } = p
  let at = addressOf(p, env)
  let made = [
    p.apps.length ? times(p.apps.length, 'app') : '',
    p.skills.length ? times(p.skills.length, 'skill') : '',
    p.integrations.length ? times(p.integrations.length, 'integration') : '',
  ].filter(Boolean)
  let about = `${space.title} shares ${made.join(', ')} on yaks.app.`
  return drawn(
    head(
      env,
      `${space.title} on yaks.app`,
      about,
      publisherAt(space.slug, env),
    ),
    h(
      'main',
      { class: 'Page' },
      h(
        Card,
        { as: 'article', class: 'Listing', 'aria-labelledby': 'publisher' },
        h(
          'header',
          { class: 'Listing_Head' },
          h('h1', { id: 'publisher', class: 'Title' }, space.title),
          h('p', { class: 'Note Note-lead' }, about),
          small(h('a', { href: `https://${at}/` }, at)),
          h(
            'ul',
            { class: 'Reputation', 'aria-label': 'What yaks.app says of it' },
            space.featured
              ? h(
                'li',
                { class: 'Reputation_Item Reputation_Item-featured' },
                'Featured by yaks.app',
              )
              : null,
            h(
              'li',
              { class: 'Reputation_Item' },
              `Installed ${times(installed(p), 'time')} by other spaces`,
            ),
          ),
        ),
        p.apps.length
          ? section(
            'apps',
            'Apps',
            h('ul', { class: 'Make_List' }, p.apps.map(card)),
          )
          : null,
        p.skills.length
          ? section(
            'skills',
            'Skills',
            h(
              'ul',
              { class: 'Publisher_List' },
              p.skills.map(({ skill, reputation }) =>
                item(
                  skill.title,
                  skillAt(skill.published.name, env),
                  skill.published.about || skill.description,
                  reputationOf(reputation),
                )
              ),
            ),
          )
          : null,
        p.integrations.length
          ? section(
            'integrations',
            'Integrations',
            h(
              'ul',
              { class: 'Publisher_List' },
              p.integrations.map((i) =>
                item(
                  i.title || i.name,
                  siteUrl(env, `/integrations#${encodeURIComponent(i.name)}`),
                  i.tagline ?? '',
                  reputationOf(i.reputation, [
                    'Listed by its owner, not reviewed by yaks.app',
                  ]),
                )
              ),
            ),
          )
          : null,
      ),
      note(
        'Shared on yaks.app, where you build, host and share web apps. ',
        h('a', { href: '/' }, 'See how it works'),
      ),
    ),
  )
}

/** The page of the space under the slug in `path`, or a 404 where it shares
 * nothing in public. */
export let answer = async (
  req: Request,
  env: Env,
  path: string,
  dir: Directory,
) => {
  if (!['GET', 'HEAD'].includes(req.method)) {
    return new Response(null, { status: 405, headers: { allow: 'GET, HEAD' } })
  }
  // A slug is its own address and needs no decoding.
  let slug = path.slice(PUBLISHER.length)
  let space = slug && !slug.includes('/') ? await dir.space(slug) : null
  if (!space || space.trashed) return lost(env)
  let found = await publishedBy(dir, space, env)
  return shares(found) ? page(found, env) : lost(env)
}
