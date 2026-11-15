// A person's sites as Google Search sees them, through their own connection to
// Google Search Console (@yaks/connections' `google-search-console`): the
// properties they hold, the clicks, impressions, click-through rate and
// position of each page or query, and the sitemaps Google reads, submitted
// from here. It calls Google through the connection (operator-google.ts
// `askGoogle`), never handing the token on.
import type { Bundle } from '@yaks/graph'
import { known } from '@yaks/connections'
import type { Space } from './directory.ts'
import { addingAt, ctxOf, ownConnection } from './connections.ts'
import { askGoogle } from './operator-google.ts'
import { type Args, type Ctx, inSpace, refuse, SPACE, str } from './tool.ts'
import { type Row } from './tool-words.ts'

/** The integration a person's Search Console connects through. */
export let SEARCH_CONSOLE = 'google-search-console'

let API = 'https://searchconsole.googleapis.com/webmasters/v3/sites'

let said = (v: unknown) => typeof v == 'string' ? v.trim() : ''

// ---- the pure part: what is asked of Google, and what its answers say ----

/** The property a site names: a bare domain is its Domain property
 * (`sc-domain:yaks.app`), and an address or `sc-domain:` stays as given. */
export let propertyOf = (site: string) => {
  let s = site.trim()
  if (!s) throw refuse('arguments', 'site: give a domain, such as yaks.app')
  return /^(sc-domain:|https?:\/\/)/.test(s) ? s : `sc-domain:${s}`
}

/** What a row is broken down by: page, query, or both. */
export let dimensionsOf = (by: unknown) => {
  let dims = (said(by) || 'page').split(',').map((d) => d.trim())
    .filter(Boolean)
  let odd = dims.find((d) => !['page', 'query'].includes(d))
  if (odd) throw refuse('arguments', `by: ${odd} is not page or query`)
  return dims
}

let day = (at: Date) => at.toISOString().slice(0, 10)

/** The search analytics query Google is asked: the last `days` days to
 * `today`, by `dims`, kept to pages and queries holding the words given. */
export let statsBody = (
  a: { dims: string[]; days?: number; page?: string; query?: string },
  limit: number,
  today: Date,
) => {
  let days = Math.min(Math.max(Math.round(a.days ?? 28), 1), 480)
  let filters = (['page', 'query'] as const)
    .filter((d) => a[d])
    .map((d) => ({ dimension: d, operator: 'contains', expression: a[d] }))
  return {
    startDate: day(new Date(today.getTime() - days * 86_400_000)),
    endDate: day(today),
    dimensions: a.dims,
    rowLimit: limit,
    ...filters.length ? { dimensionFilterGroups: [{ filters }] } : {},
  }
}

type Stat = {
  keys?: string[]
  clicks?: number
  impressions?: number
  ctr?: number
  position?: number
}

/** One row of Google's answer, as a line. */
export let statLine = (r: Stat) =>
  `${(r.keys ?? []).join(' · ')} — ${r.clicks ?? 0} clicks, ` +
  `${r.impressions ?? 0} impressions, ${((r.ctr ?? 0) * 100).toFixed(1)}% ` +
  `click-through, position ${(r.position ?? 0).toFixed(1)}`

type Sitemap = {
  path?: string
  lastSubmitted?: string
  lastDownloaded?: string
  isPending?: boolean
  errors?: string | number
  warnings?: string | number
  contents?: { type?: string; submitted?: string | number }[]
}

/** A sitemap as Google says it stands. */
export let sitemapLine = (s: Sitemap) =>
  [
    s.path ?? '',
    s.lastSubmitted ? `submitted ${s.lastSubmitted}` : 'never submitted',
    s.isPending
      ? 'waiting for Google to read it'
      : s.lastDownloaded
      ? `read ${s.lastDownloaded}`
      : 'not read yet',
    ...(s.contents ?? []).map((c) => `${c.submitted ?? 0} ${c.type ?? ''}`),
    `${s.errors ?? 0} errors`,
    `${s.warnings ?? 0} warnings`,
  ].join(', ')

// ---- where it meets the person's connection ----

// The person's connection to Search Console, or the refusal that says where
// they connect it.
let connected = async (ctx: Ctx, space: Space): Promise<Bundle> => {
  let held = await ownConnection(ctx.env, ctx, space, SEARCH_CONSOLE)
  if (held) return held
  let i = await known(ctxOf(ctx.env).graph.read, SEARCH_CONSOLE)
  throw refuse(
    'connection',
    'Google Search Console is not connected' +
      (i ? `. Connect it at ${addingAt(ctx.env, space.slug, i)}` : '') +
      ', with the Google account that holds the site in Search Console.',
  )
}

let at = (site: string, rest = '') =>
  `${API}/${encodeURIComponent(propertyOf(site))}${rest}`

let PROPERTY = 'the site as Search Console holds it: a domain such as ' +
  'yaks.app for its Domain property, or the address of a URL-prefix property'

let limitOf = (v: unknown) =>
  Math.min(Math.max(Math.round(Number(v) || 50), 1), 1000)

// The properties the account holds, when no site was named.
let sites = async (ctx: Ctx, connection: Bundle) => {
  let got = await askGoogle(ctx.env, connection, API)
  let list = (got.siteEntry ?? []) as Record<string, string>[]
  return list.length
    ? list.map((s) => `${s.siteUrl} (${s.permissionLevel})`).join('\n')
    : 'This Google account holds no property in Search Console.'
}

export let searchConsoleTools: Row[] = [
  {
    name: 'search_stats',
    readOnly: true,
    openWorld: true,
    input: {
      type: 'object',
      properties: {
        space: SPACE,
        site: str(`${PROPERTY}. Leave it out for the properties it holds`),
        by: str('page, query, or page,query for each pair (page by default)'),
        days: {
          type: 'number',
          description: 'how many days back to read, to today (28 by default)',
        },
        page: str('only pages whose address holds these words'),
        query: str('only queries holding these words'),
        limit: {
          type: 'number',
          description: 'how many rows at most (50 by default, 1000 maximum)',
        },
      },
    },
    run: async (ctx, args: Args) => {
      let { space } = await inSpace(ctx, args)
      let connection = await connected(ctx, space)
      if (!said(args.site)) {
        return { text: await sites(ctx, connection), space }
      }
      let dims = dimensionsOf(args.by)
      let body = statsBody(
        {
          dims,
          days: args.days == null ? undefined : Number(args.days),
          page: said(args.page) || undefined,
          query: said(args.query) || undefined,
        },
        limitOf(args.limit),
        new Date(),
      )
      let got = await askGoogle(
        ctx.env,
        connection,
        at(said(args.site), '/searchAnalytics/query'),
        { method: 'POST', body: JSON.stringify(body) },
      )
      let rows = (got.rows ?? []) as Stat[]
      return {
        text: `${propertyOf(said(args.site))}, ${body.startDate} to ` +
          `${body.endDate}, by ${dims.join(' · ')}:\n` +
          (rows.length
            ? rows.map(statLine).join('\n')
            : 'Google has no search data for this yet.'),
        space,
      }
    },
  },
  {
    name: 'search_sitemap',
    destructive: false,
    openWorld: true,
    input: {
      type: 'object',
      properties: {
        space: SPACE,
        site: str(PROPERTY),
        sitemap: str(
          'the address of a sitemap to submit, such as ' +
            'https://yaks.app/sitemap.xml. Leave it out for the sitemaps ' +
            'Google already has',
        ),
      },
      required: ['site'],
    },
    run: async (ctx, args: Args) => {
      let { space } = await inSpace(ctx, args)
      let connection = await connected(ctx, space)
      let site = said(args.site)
      let sitemap = said(args.sitemap)
      if (sitemap) {
        let path = `/sitemaps/${encodeURIComponent(sitemap)}`
        await askGoogle(ctx.env, connection, at(site, path), { method: 'PUT' })
        let got = await askGoogle(ctx.env, connection, at(site, path))
        return { text: `Submitted. ${sitemapLine(got as Sitemap)}`, space }
      }
      let got = await askGoogle(ctx.env, connection, at(site, '/sitemaps'))
      let list = (got.sitemap ?? []) as Sitemap[]
      return {
        text: list.length
          ? list.map(sitemapLine).join('\n')
          : `Google has no sitemap for ${propertyOf(site)} yet.`,
        space,
      }
    },
  },
]
