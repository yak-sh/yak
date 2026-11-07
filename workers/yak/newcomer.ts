// A newcomer (D-146737): somebody who typed an app idea into the home page's
// box before signing up. Pressing Build it signs their browser in as a person
// with no address and no number yet, gives them a space of their own like any
// sign-up (identity.ts `settle`), and hands their words to its Operator, which
// builds the app while they watch. Giving an address keeps it.
//
// The spending is a pilot with caps said in dollars, all of them here:
//
//   per build     a newcomer's space may spend PER_BUILD dollars on models
//                 (its `budget`, with no starter), which meter.ts `limitOf`
//                 and model-spend.ts `reserved` hold it to like any space
//   per day       DAILY newcomers' spaces open a UTC day, across everybody,
//                 and PER_SOURCE from one address, counted as each opens
//   per space     once: a budget is a month's, so a space nobody kept goes
//                 to the trash KEEPING after it opened (`unkept`), before a
//                 new month could give it PER_BUILD again
//
// So a day spends at most DAILY × PER_BUILD dollars, on the Operator's own
// models (operator.ts `operatorChoice`). Until they give an address a
// newcomer may only build: every tool outside BUILDING asks for one first
// (agent.ts `platform`), since mail, texts, numbers, members, domains and
// publishing reach people who never asked to hear from a stranger.
import { token } from '@yaks/graph'
import type { Bundle, Comp, Tool } from '@yaks/graph'
import { Stale } from '@yaks/graph/errors'
import { derivedEid } from '@yaks/graph/identity'
import { type Directory, type Space, stamp } from './directory.ts'
import type { Namespace } from './door.ts'
import { meta } from './meta.ts'
import { type Ctx, refuse } from './tool.ts'

type Env = { STORE: Namespace }

/** The dollars one newcomer's build may spend. Every Operator turn holds
 * its most before it starts (model-spend.ts `reserved`), about $1.30 for
 * its first and growing slowly with the conversation (@yaks/model
 * `requestBound`), and a turn that does not fit what is left is refused, so
 * a build spends up to this, less one such hold. */
export let PER_BUILD = 5
/** Newcomers' spaces opened a day (UTC), across everybody. */
export let DAILY = 10
/** The same, from one address. */
export let PER_SOURCE = 2

/** How long a newcomer's space waits to be kept. Past it the daily sweep
 * (erase.ts `collected`) puts the space in the trash, where it can be
 * restored for thirty days more and its Operator answers nothing. */
export let KEEPING = 7 * 86_400_000

/** Where the home page's box posts. */
export let START = '/start'

/** What the box answers once a day's builds are taken. */
export let FULL =
  "Today's free builds are all taken. Sign up free to build in your own space."

/** What a newcomer's Operator hears from a tool that reaches past building. */
export let KEEP =
  'Ask them for their email first, in the card above this chat: this space ' +
  'is a free build until they keep it, and until then it can only build.'

/** The tools a newcomer's Operator may call: making, changing and looking at
 * apps in its own space. */
export let BUILDING = new Set([
  'about',
  'app_delete',
  'app_deploy',
  'app_errors',
  'app_files',
  'app_install',
  'app_list',
  'app_new',
  'app_preview',
  'app_published',
  'app_restore',
  'app_rollback',
  'app_set',
  'app_stats',
  'app_update',
  'app_versions',
  'builder_build',
  'builder_choose',
  'builder_supply',
  'command',
  'commands',
  'connection_list',
  'gallery_search',
  'guide',
  'integration_list',
  'library_add',
  'library_list',
  'library_read',
  'memory_recall',
  'memory_save',
  'sandbox_exec',
  'sandbox_read',
  'sandbox_shell',
  'sandbox_ship',
  'sandbox_stop',
  'sandbox_wait',
  'sandbox_write',
  'store_effect_retry',
  'store_inspect',
  'store_load',
  'store_memory_recall',
  'store_memory_save',
  'store_restore',
  'store_retry',
  'store_trace',
  'store_writes',
])

/** A tool as a newcomer meets it: the same tool, refusing them when it is not
 * one of BUILDING. Who is a newcomer is read when such a tool is called, so
 * the tools that build cost nobody a read. */
export let confined = (ctx: Ctx, t: Tool): Tool =>
  BUILDING.has(t.name ?? '') ? t : {
    ...t,
    run: async (...args) => {
      if (ctx.person && await ctx.dir.newcomer(ctx.person)) {
        throw refuse('access', KEEP)
      }
      return t.run(...args)
    },
  }

let dayOf = (now: Date) => now.toISOString().slice(0, 10)
let tallyEid = (day: string, source = '') =>
  derivedEid('newcomer-builds|' + day + (source ? '|' + source : ''))
// The builds a tally's row counts on `day`: none once its day has passed.
let buildsOn = (row: Bundle | undefined, day: string) => {
  let had = row?.newcomer_builds as Comp | undefined
  return had?.day == day ? Number(had.builds ?? 0) : 0
}

/** The newcomers' spaces opened today (UTC) across everybody, against
 * DAILY: what the platform admin's Visitor builds page says (admin.ts). */
export let opened = async (dir: Pick<Directory, 'read'>, now = new Date()) => {
  let day = dayOf(now)
  return buildsOn((await dir.read(`.entity.eid=${tallyEid(day)}`))[0], day)
}

/**
 * Count one more newcomer's space today, from `source` (signin.ts `visitor`,
 * the address as a keyed hash): false when the day's or the address's builds
 * are taken. Both counts are one write, guarded on what was read, so two at
 * once never count as one.
 */
export let counted = async (env: Env, source: string, now = new Date()) => {
  let day = dayOf(now)
  let store = meta(env)
  while (true) {
    let rows = await Promise.all(
      [tallyEid(day), ...source ? [tallyEid(day, source)] : []].map(
        async (eid) => ({
          eid,
          row: (await store.query(`.entity.eid=${eid}`))[0],
        }),
      ),
    )
    let builds = rows.map(({ row }) => buildsOn(row, day))
    if (builds[0] >= DAILY || (builds[1] ?? 0) >= PER_SOURCE) return false
    try {
      await stamp(env, {
        entities: rows.map(({ eid, row }, i) => ({
          entity: { eid },
          $was: {
            newcomer_builds: {
              day: token((row?.newcomer_builds as Comp)?.day ?? null),
              builds: token((row?.newcomer_builds as Comp)?.builds ?? null),
            },
          },
          newcomer_builds: { day, builds: builds[i] + 1 },
        })),
      })
      return true
    } catch (e) {
      if (!(e instanceof Stale)) throw e
    }
  }
}

/** A newcomer's space, held to one build's dollars: its budget is PER_BUILD,
 * said to be a newcomer's so its refusals ask for their email (meter.ts
 * `unkept`), and it holds no starter. */
export let oneBuild = (env: Env, space: Space) =>
  stamp(env, {
    entities: [{
      entity: { eid: space.eid },
      budget: { dollars: PER_BUILD, newcomer: true },
      starter: { dollars: 0 },
    }],
  })

/**
 * A newcomer keeping what they built (D-146737): signing in on the browser a
 * newcomer `was`, as `person`, moves the newcomer's owner seats to them, so
 * the spaces, their apps and their chats are theirs. Each space is lifted to
 * its plan's budget, and to the starter too when this is the first space
 * `person` has started. A space is their own only when they own none yet.
 * Nothing happens for anyone who was not a newcomer.
 */
export let keep = async (
  env: Env,
  dir: Directory,
  was: string | null,
  person: string,
) => {
  if (!was || was == person || !await dir.newcomer(was)) return
  let [theirs, mine, [row]] = await Promise.all([
    dir.seats(was, 'owner'),
    dir.seats(person, 'owner'),
    meta(env).query(`.entity.eid=${person}&?started`),
  ])
  if (!theirs.length) return
  let first = !row?.started
  await stamp(env, {
    entities: [
      ...theirs.flatMap((s) => [
        {
          entity: { eid: s.seat },
          member: { person, own: !mine.length && s == theirs[0] },
        },
        {
          entity: { eid: s.space.eid },
          budget: null,
          ...first && s == theirs[0] ? { starter: null } : {},
        },
      ]),
      ...first
        ? [{ entity: { eid: person }, started: { space: theirs[0].space.eid } }]
        : [],
    ],
  })
}

/**
 * The spaces newcomers opened more than KEEPING ago that nobody kept and
 * that are not in the trash yet, each with the newcomer who owns it. Keeping
 * moves a newcomer's owner seats to whoever signed in (`keep`), so a seat a
 * newcomer still holds is a space nobody kept.
 */
export let unkept = async (env: Env, dir: Directory, now = new Date()) => {
  let since = now.getTime() - KEEPING
  let people = (await meta(env).query('.newcomer ?email ?phone')).filter((r) =>
    !r.email && !r.phone &&
    Date.parse(String((r.newcomer as Comp).at)) <= since
  ).map((r) => r.entity.eid)
  let seats = await Promise.all(people.map((p) => dir.seats(p, 'owner')))
  return seats.flatMap((held, i) =>
    held.filter((s) => !s.space.trashed)
      .map((s) => ({ space: s.space, person: people[i] }))
  )
}
