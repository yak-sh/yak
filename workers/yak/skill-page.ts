// A published skill's own page on yaks.app (D-160631, T-161783), at
// https://yaks.app/skills/<name>: what the skill is, who shared it, its
// instructions, and what its rounds measured. For each round, the page shows
// the variants it was compared with, the cases they were tried on, every
// output, who judged and what won, then each version the skill became.
//
// A skill gets a page once yaks.app has reviewed and listed the version on
// offer (shared-skill.ts). Before that its text is not ours to show, so its
// address answers as nothing published. The page is in the sitemap (seo.ts),
// so several skills tried on the same cases can be found and compared.
//
// The results are read from the publishing space's Operator store, where the
// skill and its rounds are kept (operator-skills.ts `results`). The store
// counts only the platform's own runs, and a round shows as measured only
// once a person has picked between two of its outputs. Publishing a skill
// makes the cases and outputs of its rounds public with it.
//
// Someone else's skill says who wrote it, where and at which commit. A copy
// yaks.app hosts shows its licence notice; one whose licence allows no copy
// shows a link to its source in place of its instructions
// (shared-skill.ts `linked`).
import type { Directory, SkillOffer, Space } from './directory.ts'
import type { Env } from './env.ts'
import { caught } from './defects.ts'
import { standing } from './gallery-row.ts'
import { builderOf, SPACE } from './build-door.ts'
import { RESULTS } from './operator-skills.ts'
import { type ComponentChildren, h } from 'preact'
import { Card } from '@yaks/ui/parts'
import { type Host, spaceHost, url as siteUrl } from '@yaks/platform/host'
import { lost } from './pages.ts'
import { drawn, head } from './shell.ts'
import { type Measured, versions } from '@yaks/trial/measured'
import { linked } from '@yaks/platform/upstream'

/** Where a skill's page is, under its platform-wide name. */
export let PATH = '/skills/'
export let skillAt = (name: string, env: Host = {}) =>
  siteUrl(env, `${PATH}${encodeURIComponent(name)}`)

/** The skills that have a page: every one listed, newest first. */
export let paged = async (dir: Directory) =>
  (await dir.skillOffers()).filter((s) => standing(s.skill) == 'listed')

/** Every skill page's address, for the sitemap (seo.ts). */
export let addresses = async (dir: Directory, env: Host = {}) =>
  (await paged(dir)).map((s) => skillAt(s.skill.published.name, env))

/** What the rounds of a skill measured, asked of its space's Operator. */
export let measuredOf = async (
  env: Env,
  space: Space,
  skill: SkillOffer,
): Promise<Measured[]> => {
  let answer = await builderOf(env, space.eid)(() =>
    new Request('https://builder' + RESULTS, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-yak-kernel': '1',
        [SPACE]: space.eid,
      },
      body: JSON.stringify({ skill: skill.eid }),
    })
  )
  if (!answer.ok) throw new Error(`${RESULTS} answered ${answer.status}`)
  return await answer.json() as Measured[]
}

let note = (...said: ComponentChildren[]) => h('p', { class: 'Note' }, ...said)
let small = (...said: ComponentChildren[]) =>
  h('p', { class: 'Note Note-small' }, ...said)
let times = (n: number, one: string) => `${n} ${one}${n == 1 ? '' : 's'}`

// A variant as a line: its title and what it believes, and where it came
// from when it was not written here.
let variant = (r: Measured, v: Measured['variants'][number]) =>
  h(
    'li',
    null,
    h('strong', null, v.title || 'Untitled'),
    v.eid == r.winner ? ' (won)' : '',
    v.theory ? ` — ${v.theory}` : '',
    h(
      'span',
      { class: 'Note-small' },
      ` Chosen in ${v.preferred} of ${times(v.shown, 'comparison')}.`,
      v.source ? ` From ${v.source}` : '',
      v.licence ? ` (${v.licence})` : '',
    ),
  )

// One case with every output written for it, each under its variant.
let kase = (r: Measured, c: Measured['cases'][number]) => {
  let titled = new Map(r.variants.map((v) => [v.eid, v.title]))
  let outputs = r.outputs.filter((o) => o.case == c.eid)
  return h(
    'details',
    { class: 'Measured_Case' },
    h(
      'summary',
      null,
      c.title || 'Something its maker published',
      ` (${times(outputs.length, 'output')})`,
    ),
    c.body ? h('pre', { class: 'Measured_Text' }, c.body) : null,
    ...outputs.map((o) =>
      h(
        'section',
        { class: 'Measured_Output' },
        h(
          'h4',
          null,
          o.variant ? titled.get(o.variant) ?? 'A variant' : 'A person’s own',
        ),
        ...r.parts.filter((p) => o.parts[p]).map((p) =>
          h('p', null, h('strong', null, `${p}: `), o.parts[p])
        ),
      )
    ),
  )
}

let round = (r: Measured) =>
  h(
    'section',
    { class: 'Measured', 'aria-label': r.title },
    h('h3', null, r.title),
    note(
      `${times(r.picks, 'pick')} by ${times(r.people, 'person')}`,
      r.judges.length
        ? `, and by ${
          r.judges.map((j) =>
            `${j.title} (right on ${j.agreed} of ${j.sat} known answers)`
          ).join(', ')
        }`
        : '',
      '.',
    ),
    h('h4', null, 'Compared'),
    h('ul', null, r.variants.map((v) => variant(r, v))),
    h('h4', null, 'Cases and outputs'),
    ...r.cases.map((c) => kase(r, c)),
  )

// Who wrote someone else's skill, and the commit of its source it was taken
// at, linked.
let written = (skill: SkillOffer) => {
  let up = skill.upstream!
  return small(
    `Written by ${up.author}, at `,
    h('a', { href: up.source, rel: 'noopener' }, up.source),
    ` (${up.commit}), `,
    up.licence ? `under ${up.licence}.` : 'with no licence.',
    linked(skill)
      ? ' Its licence allows no copy, so yaks.app lists it as a link.'
      : '',
  )
}

// Its instructions, and the notice a copy keeps, or the link to them.
let instructions = (skill: SkillOffer) =>
  linked(skill)
    ? note(
      h(
        'a',
        { href: skill.upstream!.source, rel: 'noopener' },
        'Read its instructions at its source',
      ),
      '.',
    )
    : [
      h('pre', { class: 'Measured_Text' }, skill.body),
      skill.upstream
        ? [
          h('h2', null, 'Its licence notice'),
          h('pre', { class: 'Measured_Text' }, skill.upstream.notice),
        ]
        : null,
    ]

export let page = (
  at: { space: Space; skill: SkillOffer },
  rounds: Measured[] | null,
  env: Host = {},
) => {
  let { space, skill } = at
  let shown = (rounds ?? []).filter((r) => r.measured)
  let became = versions(rounds ?? [])
  return drawn(
    head(
      env,
      `${skill.title}, a skill shared on yaks.app`,
      skill.published.about || skill.description,
      skillAt(skill.published.name, env),
    ),
    h(
      'main',
      { class: 'Page' },
      h(
        Card,
        { as: 'article', class: 'Listing', 'aria-labelledby': 'skill' },
        h(
          'header',
          { class: 'Listing_Head' },
          h('h1', { id: 'skill', class: 'Title' }, skill.title),
          h(
            'p',
            { class: 'Note Note-lead' },
            skill.published.about || skill.description,
          ),
          skill.upstream ? written(skill) : null,
          small(
            `Shared from ${
              spaceHost(env, space.slug)
            }, version ${skill.published.version}.`,
            linked(skill)
              ? ''
              : ` To use it, ask your Operator to install the skill ${skill.published.name}.`,
          ),
        ),
        h('h2', null, 'When to use it'),
        note(skill.description),
        h('h2', null, 'Its instructions'),
        instructions(skill),
        h('h2', null, 'Measured'),
        rounds == null
          ? note('Its results could not be read just now.')
          : shown.length
          ? shown.map(round)
          : note(
            'Not measured yet. A skill shows results here once a person has picked between outputs written with it and without it.',
          ),
        small(
          'Writers in these trials are offered no tools, so what a skill does for an agent that uses tools is not measured here.',
        ),
        became.length
          ? [
            h('h2', null, 'Versions'),
            h(
              'ol',
              null,
              became.map((v) =>
                h(
                  'li',
                  null,
                  h('strong', null, v.variant.title),
                  v.won ? `, which won ${v.won}` : '',
                  v.from ? `, changed from ${v.from}` : '',
                  v.variant.theory ? ` — ${v.variant.theory}` : '',
                )
              ),
            ),
          ]
          : null,
      ),
      h(
        'p',
        { class: 'Note Listing_Made' },
        'Shared on yaks.app, where an Operator builds the apps you need. ',
        h('a', { href: '/' }, 'See how it works'),
      ),
    ),
  )
}

/** The page of the skill listed under the name in `path`, or a 404. */
export let answer = async (
  req: Request,
  env: Env,
  path: string,
  dir: Directory,
) => {
  if (!['GET', 'HEAD'].includes(req.method)) {
    return new Response(null, { status: 405, headers: { allow: 'GET, HEAD' } })
  }
  // A published name is a slug (shared-skill.ts), its own address.
  let name = path.slice(PATH.length)
  let found = name && !name.includes('/')
    ? await dir.skillOffered({ name })
    : null
  if (!found || standing(found.skill) != 'listed') return lost(env)
  let rounds = await measuredOf(env, found.space, found.skill).catch((e) => {
    caught(e, { request: 'skill page results', space: found.space.eid })
    return null
  })
  return page(found, rounds, env)
}
