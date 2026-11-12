// The directory as the platform's admin reads it (admin.ts): a person, a
// space or an app, drawn as a row saying what it uses and as a page of its
// own. A row's components say who or what it is; what it uses is counted over
// the whole directory by the page (admin.ts `uses`) and rides as context,
// since a space's apps and a person's budget are other rows. So do the names
// of what it points at: a reference is drawn by name and links to its page.
// The Invites page draws an invite somebody signed up with, and a person
// given the starter, as rows of the same shape, and the Visitor builds page
// a visitor's build.

import { parse } from '@yaks/query'
import { type Days, sparkline } from '@yaks/ui/chart'
import type { Child, Context, H, Renderer } from '@yaks/render'
import { COMPED } from '../directory.ts'
import { time } from '@yaks/ui/parts'
import {
  personName,
  type Stamp,
  stamped as saying,
  stampOf,
  type Writers,
} from '../stamps.ts'
import { count, dollars, size } from '../meter.ts'

/** What one row uses, as the page counted it. */
export type Uses = {
  /** dollars spent this month, and the budget they come out of */
  spend?: { spent: number; limit?: number }
  /** this month's requests */
  requests?: number
  /** page views over the last 30 days; null before the first reading */
  visits?: number | null
  /** when it was last deployed, and by whom */
  deployed?: Stamp | null
  /** when a write last changed its store */
  changed?: string | null
  /** when its code last reported an error */
  errored?: string | null
  /** who owns its space, by name */
  owners?: string[]
  /** dollars and requests, day by day, for their charts */
  spending?: Days
  requesting?: Days
  /** bytes held: databases and files */
  storage?: number
  /** apps held, the trash left out */
  apps?: number
  /** when anything here was last used */
  active?: string | null
  /** nobody's work: every way in is a test account */
  test?: boolean
}

/** Something a row points at, by the name a person reads. */
export type Ref = { eid: string; name: string }

type Comp = Record<string, unknown> | undefined
let str = (v: unknown) => typeof v == 'string' ? v : ''
let num = (v: unknown) => typeof v == 'number' ? v : 0
let uses = (ctx: Context): Uses => (ctx.uses ?? {}) as Uses
let at = (ctx: Context, eid: string) => `${str(ctx.base)}/${eid}`

let spend = (s?: Uses['spend']) =>
  s == null
    ? ''
    : s.limit == null
    ? dollars(s.spent)
    : `${dollars(s.spent)} of ${dollars(s.limit)}`
let when = <N>(h: H<N>, iso?: string | null) =>
  iso ? time(h, { at: iso }) : 'never'
let stamped = <N>(
  h: H<N>,
  ctx: Context,
  s: unknown,
  _month?: 'long' | 'short',
) => saying(h, stampOf(s), (ctx.writers ?? new Map()) as Writers) || 'never'
// What a space pays: a paid plan, or the Plus plan given (a comp).
let plan = (b: Record<string, unknown>) =>
  COMPED.includes(str((b.space as Comp)?.slug))
    ? 'Plus, comped'
    : str((b.plan as Comp)?.tier) == 'pro'
    ? 'Pro'
    : str((b.plan as Comp)?.tier) == 'plus'
    ? 'Plus'
    : 'Free'

let visits = (n?: number | null) =>
  n === undefined || n === null ? 'not counted yet' : count(n)

// A figure and how it got there, each drawn where the number is.
let trended = <N>(h: H<N>, value: string, days?: Days, noun?: string) =>
  days
    ? [value, sparkline(h, { ...days, ...noun ? { noun } : { money: true } })]
    : value

let tag = <N>(h: H<N>, text: string, warn = false) =>
  h(
    'span',
    { class: warn ? 'State State-negative' : 'Chip' },
    warn ? h('span', { class: 'Dot Dot-negative' }) : null,
    text,
  )
let tags = <N>(
  h: H<N>,
  b: Record<string, unknown>,
  u: Uses,
  ...more: string[]
) => [
  ...more.filter(Boolean).map((t) => tag(h, t)),
  u.test ? tag(h, 'test') : null,
  b.trashed ? tag(h, 'in the trash', true) : null,
]

// What "Last active" measures, said where it is read.
let ACTIVE =
  "The last sign-in, tool call (an assistant's included), page view, request " +
  'or store write by them or in what they own, to the hour.'
let NOTES: Record<string, string> = {
  'Last active': ACTIVE,
  Deployed: 'When its newest release went up.',
  'Data changed':
    "The last write to the app's store, to the hour, an install or a schema " +
    'move left out.',
  'Last error': "The last error the app's code reported, to the hour.",
}
let noted = (key: string) => NOTES[key] ? { title: NOTES[key] } : null

// A row: its name, stretched over the row as its link, a line under it, and
// what it uses, each figure under the word for it.
let row = <N>(
  h: H<N>,
  ctx: Context,
  eid: string,
  name: string,
  sub: string,
  marks: Child<N>[],
  figures: [string, Child<N>][],
) =>
  h(
    'div',
    { class: 'Directory_Row' },
    h(
      'div',
      { class: 'Directory_Who' },
      h(
        'a',
        { class: 'Directory_Open', href: at(ctx, eid) },
        h('strong', null, name),
      ),
      h('span', { class: 'Directory_Sub' }, sub),
      h('div', { class: 'Chips' }, ...marks),
    ),
    h(
      'dl',
      { class: 'Directory_Uses' },
      ...figures.map(([key, value]) =>
        h(
          'div',
          { class: 'Directory_Figure' },
          h('dt', { ...noted(key), class: 'Directory_Label' }, key),
          h('dd', { class: 'Directory_Value' }, value),
        )
      ),
    ),
  )

let link = <N>(h: H<N>, ctx: Context, r: Ref) =>
  h('a', { href: at(ctx, r.eid) }, r.name)
let refs = <N>(h: H<N>, ctx: Context, all: Ref[]) =>
  all.length
    ? all.flatMap((r, i) => i ? [', ', link(h, ctx, r)] : [link(h, ctx, r)])
    : 'none'

// A page's facts, each a word and what it is; a fact with nothing to say is
// left out rather than said empty.
let facts = <N>(h: H<N>, all: [string, Child<N>][]) =>
  h(
    'dl',
    { class: 'Fields Directory_Facts' },
    ...all.filter(([, v]) => v !== '' && v != null).map(([key, value]) =>
      h(
        'div',
        { class: 'Fields_Row' },
        h('dt', { ...noted(key), class: 'Fields_Label' }, key),
        h('dd', { class: 'Fields_Value' }, value),
      )
    ),
  )

/** What an admin calls a person: the name they gave, else the front of their
 * address, else their number to text, else the row's own number, which is all
 * an account that kept no address has to tell it apart. */
let personOf = (b: Record<string, unknown>) => ({
  email: str((b.email as Comp)?.address),
  phone: str((b.phone as Comp)?.number),
  name: personName(b),
})

let person: Renderer = {
  view: 'Directory.List.Tile',
  match: parse('.person'),
  render: (b, h, ctx) => {
    let u = uses(ctx)
    let p = personOf(b)
    return row(
      h,
      ctx,
      b.entity.eid,
      p.name,
      p.email || p.phone,
      tags(h, b, u),
      [
        ['Spent this month', trended(h, spend(u.spend), u.spending)],
        ['Storage', size(u.storage ?? 0)],
        ['Apps', count(u.apps ?? 0)],
        ['Last active', when(h, u.active)],
      ],
    )
  },
}

let space: Renderer = {
  view: 'Directory.List.Tile',
  match: parse('.space'),
  render: (b, h, ctx) => {
    let u = uses(ctx)
    let pays = plan(b)
    return row(
      h,
      ctx,
      b.entity.eid,
      str((b.space as Comp)?.slug),
      str(ctx.address),
      tags(h, b, u, pays == 'Free' ? '' : pays),
      [
        ['Spent this month', trended(h, spend(u.spend), u.spending)],
        ['Storage', size(u.storage ?? 0)],
        ['Apps', count(u.apps ?? 0)],
        ['Last active', when(h, u.active)],
      ],
    )
  },
}

// Whether it stands published, and whether the gallery lists it: the gallery
// shows only a published app, whatever its gallery word still says.
let offered = (b: Record<string, unknown>) =>
  (b.published as Comp)?.name
    ? ['published', (b.gallery as Comp)?.listed_at ? 'in the gallery' : '']
    : ['not published']

let app: Renderer = {
  view: 'Directory.List.Tile',
  match: parse('.app'),
  render: (b, h, ctx) => {
    let u = uses(ctx)
    let a = b.app as Comp
    let slug = str(a?.slug)
    let version = num(a?.version)
    return row(
      h,
      ctx,
      b.entity.eid,
      str((b.doc as Comp)?.title) || slug,
      [`${str(ctx.space)}/${slug}`, ...u.owners ?? []].join(' · '),
      tags(h, b, u, str(a?.access), ...offered(b)),
      [
        ['Made', stamped(h, ctx, b.created)],
        ['Deployed', stamped(h, ctx, u.deployed)],
        ['Data changed', when(h, u.changed)],
        ['Last active', when(h, u.active)],
        ['Last error', when(h, u.errored)],
        [
          'Requests this month',
          trended(h, count(u.requests ?? 0), u.requesting, 'request'),
        ],
        ['Visits, 30 days', visits(u.visits)],
        ['Storage', size(u.storage ?? 0)],
        ['Version', version ? `v${version}` : 'none'],
      ],
    )
  },
}

let stamp = (b: Record<string, unknown>, comp: string) =>
  str((b[comp] as Comp)?.at)

// Somebody who signed up through an invite (referral.ts), drawn on the
// admin's Invites page: who invited them and when, and the month their first
// app gave (reward.ts), to which space and through when, a space the payment
// provider bills having had its next charge moved. The row opens the person invited.
let referral: Renderer = {
  view: 'Directory.List.Tile',
  match: parse('.referral'),
  render: (b, h, ctx) => {
    let invitee = ctx.invitee as Ref, inviter = ctx.inviter as Ref
    let given = b.rewarded as Comp
    return row(
      h,
      ctx,
      invitee.eid,
      invitee.name,
      `invited by ${inviter.name}`,
      [given?.subscription ? tag(h, 'charge moved') : null],
      [
        ['Signed up', stamped(h, ctx, b.created)],
        ['First app', given ? when(h, str(given.at)) : 'not yet'],
        ['Month to', given ? str(ctx.space) || 'a space gone' : ''],
        ['Free through', given ? when(h, str(given.until)) : ''],
      ],
    )
  },
}

// Somebody given the starter (meter.ts `STARTER`), drawn on the admin's
// Invites page: when, to which space, what of it is left and what their
// spaces spent this month.
let starter: Renderer = {
  view: 'Directory.Starter.Tile',
  match: parse('.started'),
  render: (b, h, ctx) => {
    let u = uses(ctx)
    let p = personOf(b)
    let at = str(ctx.at)
    return row(
      h,
      ctx,
      b.entity.eid,
      p.name,
      p.email || p.phone,
      tags(h, b, u),
      [
        ['Given', at ? time(h, { at }) : 'unknown'],
        ['Space', str(ctx.space) || 'gone'],
        ['Starter left', dollars(num(ctx.left))],
        ['Spent this month', trended(h, spend(u.spend), u.spending)],
      ],
    )
  },
}

// A visitor's build (newcomer.ts), drawn on the admin's Visitor builds page:
// the space the home page's box opened, when, what its models spent this
// month against its budget, its apps, and who kept it by signing up, if
// anybody has, or that it went to the trash unkept. The row opens the space.
let build: Renderer = {
  view: 'Directory.Build.Tile',
  match: parse('.visitor_build'),
  render: (b, h, ctx) => {
    let space = ctx.space as Ref | undefined
    let u = uses(ctx), keeper = str(ctx.keeper)
    return row(
      h,
      ctx,
      space?.eid ?? b.entity.eid,
      space?.name ?? 'A space gone',
      str(ctx.address),
      [
        keeper ? tag(h, 'kept') : null,
        ctx.trashed ? tag(h, 'in the trash', true) : null,
      ],
      [
        ['Opened', time(h, { at: stamp(b, 'visitor_build') }) || 'unknown'],
        ['Spent this month', trended(h, spend(u.spend), u.spending)],
        ['Apps', count(u.apps ?? 0)],
        ['Kept by', keeper || 'not yet'],
      ],
    )
  },
}

let personPage: Renderer = {
  view: 'Directory.Page',
  match: parse('.person'),
  render: (b, h, ctx) => {
    let u = uses(ctx)
    let p = personOf(b)
    let signed = b.signed_in as Comp
    return facts(h, [
      ['Email', p.email],
      ['Phone', p.phone],
      ['Joined', stamped(h, ctx, b.created)],
      [
        'Signed in',
        signed?.at
          ? [
            time(h, { at: str(signed.at) }),
            signed.via ? ` by ${signed.via}` : '',
          ]
          : 'never',
      ],
      ['Last active', when(h, u.active)],
      ['Spent this month', trended(h, spend(u.spend), u.spending)],
      ['Storage', size(u.storage ?? 0)],
      ['Apps', count(u.apps ?? 0)],
    ])
  },
}

let spacePage: Renderer = {
  view: 'Directory.Page',
  match: parse('.space'),
  render: (b, h, ctx) => {
    let u = uses(ctx)
    let status = str((b.plan as Comp)?.status)
    let m = (b.meter as Comp) ?? {}
    let address = str(ctx.address)
    let owners = (ctx.owners ?? []) as Ref[]
    return facts(h, [
      ['Address', h('a', { href: `https://${address}/` }, address)],
      ['Plan', `${plan(b)}${status ? ` · ${status}` : ''}`],
      ['Owners', refs(h, ctx, owners)],
      ['Made', stamped(h, ctx, b.created)],
      ['Last active', when(h, u.active)],
      ['Spent this month', trended(h, spend(u.spend), u.spending)],
      ['Database', size(num(m.bytes))],
      ['Files', size(num(m.files))],
      ['Requests', trended(h, count(num(m.requests)), u.requesting, 'request')],
      ['Rows read', count(num(m.rows_read))],
      ['Rows written', count(num(m.rows_written))],
      ['Compute seconds', count(num(m.seconds))],
      ['Letters', count(num(m.emails))],
      [
        'Metered',
        m.at ? [`${str(m.month)}, read `, time(h, { at: str(m.at) })] : 'never',
      ],
    ])
  },
}

let appPage: Renderer = {
  view: 'Directory.Page',
  match: parse('.app'),
  render: (b, h, ctx) => {
    let u = uses(ctx)
    let a = b.app as Comp
    let published = b.published as Comp
    let m = (b.meter as Comp) ?? {}
    let address = str(ctx.address)
    let from = ctx.from as Ref | undefined
    let deploys = ctx.deploys as number | undefined
    // The live release's message, as whoever released it wrote it.
    let message = ctx.message as string | undefined
    let visits = ctx.visits as number | null | undefined
    return facts(h, [
      ['Address', h('a', { href: `https://${address}/` }, address)],
      ['Space', ctx.home ? link(h, ctx, ctx.home as Ref) : ''],
      ['Access', str(a?.access)],
      ['Version', num(a?.version) ? `v${num(a?.version)}` : 'none'],
      [
        'Deploys',
        deploys
          ? [
            count(deploys),
            u.deployed ? [', the last ', stamped(h, ctx, u.deployed)] : null,
          ]
          : '',
      ],
      [
        'What it changed',
        message ? h('p', { class: 'Directory_Said' }, message) : '',
      ],
      [
        'Published',
        published?.name
          ? `as ${published.name} v${num(published.version)}`
          : '',
      ],
      ['Installed from', from ? link(h, ctx, from) : ''],
      ['Made', stamped(h, ctx, b.created)],
      ['Last active', when(h, u.active)],
      ['Data changed', when(h, u.changed)],
      ['Last error', when(h, u.errored)],
      [
        'Visits, 30 days',
        visits === undefined
          ? ''
          : visits === null
          ? 'not counted here'
          : trended(
            h,
            count(visits),
            ctx.visiting as Days | undefined,
            'visit',
          ),
      ],
      [
        'Requests this month',
        trended(h, count(num(m.requests)), u.requesting, 'request'),
      ],
      ['Rows read this month', count(num(m.rows_read))],
      ['Rows written this month', count(num(m.rows_written))],
      ['Database', size(num(m.bytes))],
      [
        'Metered',
        m.at ? [`${str(m.month)}, read `, time(h, { at: str(m.at) })] : 'never',
      ],
    ])
  },
}

export let directory = [
  person,
  space,
  app,
  referral,
  starter,
  build,
  personPage,
  spacePage,
  appPage,
]
