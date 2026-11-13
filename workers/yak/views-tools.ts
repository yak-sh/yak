// The view tools, their rows apart from views.ts so a page that only serves a
// space never compiles the roster's words (T-148886).
import { APP, inApp, SPACE as SPACE_ARG } from './tool.ts'
import { type Row, worded } from './tool-words.ts'
import { url as appUrl } from './directory.ts'
import { ago, NOT_ON, statsOf } from './views.ts'
import { installedBy, ratedAs } from './gallery-row.ts'

// The rows, said as rows: the words each says about itself are in
// tools.yml under its name (tool-words.ts `worded`).
let STATS: Row[] = [
  {
    name: 'app_stats',
    readOnly: true,
    // The numbers come from Cloudflare's analytics, past yaks.app.
    openWorld: true,
    input: {
      type: 'object',
      properties: {
        space: SPACE_ARG,
        app: APP,
        days: {
          type: 'number',
          description:
            'how far back, in days (default 30). Cloudflare keeps three ' +
            'months, so anything past 90 is the same answer as 90.',
        },
      },
      required: ['app'],
    },
    run: async (ctx, args) => {
      let { space, app } = await inApp(ctx, args)
      let days = args.days == null ? undefined : Number(args.days)
      // No token, no numbers — one sentence rather than an error, because
      // there is nothing the agent or the person can do about it (views.ts).
      // A published app's installs and rating are credited to its space
      // (T-131912, T-160643).
      let uptake = app.published
        ? await ctx.dir.uptake(app.eid, space.eid)
        : null
      let took = uptake
        ? [
          installedBy(uptake.installs),
          ...uptake.rated ? [ratedAs(uptake.rated)] : [],
        ]
        : []
      let asked = statsOf(ctx.env, app.eid, days)
      if (!asked) return { text: [NOT_ON, ...took].join('\n'), space }
      let seen = await asked
      let list = (head: string, rows: { name: string; views: number }[]) =>
        rows.length
          ? [`${head}:`, ...rows.map((r) => `- ${r.name} — ${r.views}`)]
          : []
      let text = seen.total
        ? [
          `${space.slug}/${app.slug} — ${seen.total} ${
            seen.total == 1 ? 'visit' : 'visits'
          } in ${seen.days} ` +
          `days${ago(seen)} (${appUrl(space, app, ctx.env)})`,
          ...list('Pages', seen.pages),
          ...list('Came from', seen.from),
          ...list('Countries', seen.countries),
        ].join('\n')
        : `${space.slug}/${app.slug} — nobody has opened it in ${seen.days} ` +
          `days${ago(seen)}`
      return { text: [text, ...took].join('\n'), space }
    },
  },
]

/** The connector row for reading an app's visitor counts. */
export let viewsTools = STATS.map(worded)
