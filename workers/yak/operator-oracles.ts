// Topics live beside the Operator's work, projected for the person whose
// reach reads the spaces and apps they describe. Source documents are refreshed when consulted; the contents
// an oracle keeps are never replaced by discovery.
import {
  addressed,
  type Bundle,
  type Comp,
  type Graph,
  unheld,
} from '@yaks/graph'
import { derivedEid } from '@yaks/graph/identity'
import { link } from '@yaks/edge'
import { short } from '@yaks/id'
import { compile, gather, named, ORACLE } from '@yaks/topic'
import { safe } from '@yaks/text'
import { inReach } from './declared.ts'
import { type App, type Space, url } from './directory.ts'
import { instructions } from './guide.ts'
import { told } from './memory.ts'
import { appEntry, holds, listed } from './standing.ts'
import { type Ctx, refuse } from './tool.ts'
import { absent, and, eq, or } from '@yaks/query/core'

// What yaks.app is to the Operator, and how it reaches the oracles, is the
// base persona's plugins/yaks.app/persona/platform.md.
let ORACULAR =
  "You are the oracle of the topic below. Answer questions from its cover, contents and sources. When they do not answer the question, read the app or space through your tools. Distinguish what you read from what you infer, and say when you do not know. Keep the topic accurate: when you learn something missing, rewrite its content.body through graph_apply with self true, the topic's #id and the $was token supplied below. Keep sources current; an app's notes and a space's memories outrank an older summary. Your final answer goes to the fork that asked you, which reports to the person. For another subject consult its oracle with spawn and topic. Your own graph is read or written with self true; app tools reach the apps as usual."

let keep = async (g: Graph, wanted: Bundle[]) => {
  let held = await g.get(wanted.map((b) => b.entity.eid))
  let writes = unheld(held, wanted)
  if (writes.length) await g.apply(writes, { trusted: true })
}

/** One reader's topic for a directory space or app. */
export let oracleOf = (person: string, subject: string): string =>
  derivedEid(`operator-oracle|${person}|${subject}`)

let projected = (person: string, subject: string, b: Bundle): Bundle => ({
  ...b,
  operator_oracle: { person, subject },
})

let topic = (
  person: string,
  subject: string,
  title: string,
  body: string,
): Bundle =>
  projected(person, subject, {
    entity: { eid: oracleOf(person, subject) },
    // Slugs can be reused while an older oracle still keeps its knowledge.
    topic: { name: named(`${title} ${oracleOf(person, subject)}`) },
    doc: { title, body },
  })

let source = (from: string, key: string, title: string, body: string) => {
  let eid = derivedEid(`operator-oracle|${key}|${from}`)
  return [
    { entity: { eid }, doc: { title, body } },
    link(from, 'contains', eid),
  ]
}

let sources = (
  person: string,
  subject: string,
  key: string,
  title: string,
  body: string,
) =>
  source(oracleOf(person, subject), key, title, body)
    .map((b) => projected(person, subject, b))

type Subjects = { spaces: Space[]; apps: { space: Space; app: App }[] }
let subjects = async (ctx: Ctx): Promise<Subjects> => {
  let [spaces, apps] = await Promise.all([
    ctx.dir.spaces(ctx.person),
    inReach(ctx),
  ])
  return {
    spaces: [...new Map(
      [...spaces, ...apps.map((r) => r.space)].map((s) => [s.eid, s]),
    ).values()],
    apps,
  }
}

let topics = (person: string, { spaces, apps }: Subjects): Bundle[] => [
  ...spaces.map((s) =>
    topic(person, s.eid, s.slug, `The space ${s.slug}: ${s.title}.`)
  ),
  ...apps.flatMap(({ space, app }) => [
    topic(
      person,
      app.eid,
      `${space.slug}/${app.slug}`,
      `${app.title || app.slug}. ${url(space, app)}`,
    ),
    projected(
      person,
      app.eid,
      link(oracleOf(person, space.eid), 'contains', oracleOf(person, app.eid)),
    ),
  ]),
]

/** The short map shared by a conversation and its work forks: each app with
 * what it holds and the commands it declares for its regular tasks, so a file
 * or a fact that belongs in one is known to have a home there, and a task a
 * command (T-162679, D-162751). The lines come from the caller's roster
 * (standing.ts `listed`), so no app's notes, memories or connector guide are
 * read for it. */
export let oracleMap = async (ctx: Ctx, g: Graph): Promise<string> => {
  let all = await subjects(ctx)
  let [, lines] = await Promise.all([
    keep(g, topics(ctx.person, all)),
    listed(ctx, all.apps),
  ])
  return [
    '## Oracles',
    ...all.spaces.flatMap((s) => [
      `- ${short(oracleOf(ctx.person, s.eid))} space ${safe(s.slug)}: ${
        safe(s.title)
      }`,
      ...lines.filter((l) => l.space.eid == s.eid).map((l) =>
        `  - ${short(oracleOf(ctx.person, l.app.eid))} app ${
          safe(s.slug + '/' + l.app.slug)
        }: ${safe(l.app.title)}, ${safe(holds(l.kinds))}${
          l.does.length ? `; does ${safe(l.does.join(', '))}` : ''
        }${l.noted ? '; its notes say how' : ''}${
          l.shapes.map((k) => `\n    - kind ${safe(k)}`).join('')
        }`
      ),
    ]),
  ].join('\n')
}

/** The topic an oracle is asked about, by the `#id` the map names it with
 * (or its eid), resolved as the Operator's own graph resolves any id. */
export let oracleTopic = async (ctx: Ctx, g: Graph, said: string) => {
  let all = await subjects(ctx)
  await keep(g, topics(ctx.person, all))
  let [eid] = await addressed(g, [said])
  return resolve(ctx.person, all, eid)
}

let resolve = (person: string, all: Subjects, eid: string) => {
  let subject = [...all.spaces, ...all.apps.map((a) => a.app)]
    .find((s) => s.eid == eid || oracleOf(person, s.eid) == eid)
  if (!subject) throw refuse('access', 'That topic is outside your reach.')
  return oracleOf(person, subject.eid)
}

/** Refresh only this oracle's sources, then use the topic package's context
 * compiler. Discovery never overwrites the oracle's learned contents. */
export let oracleContext = async (ctx: Ctx, g: Graph, eid: string) => {
  let all = await subjects(ctx)
  eid = resolve(ctx.person, all, eid)
  let app = all.apps.find((a) => oracleOf(ctx.person, a.app.eid) == eid)
  let space = all.spaces.find((
    s,
  ) => (app ? s.eid == app.space.eid : oracleOf(ctx.person, s.eid) == eid))
  if (!space || (!app && oracleOf(ctx.person, space.eid) != eid)) {
    throw refuse('access', 'That topic is outside your reach.')
  }
  let memories = sources(
    ctx.person,
    space.eid,
    'memories',
    `${space.slug}: memories`,
    await told(ctx.env, space),
  )
  let guide = source(
    ORACLE,
    'platform',
    'yaks.app connector guide',
    instructions(ctx.env),
  )
  let [persona] = await g.get([ORACLE])
  await keep(g, [
    ...topics(ctx.person, all),
    ...persona ? [] : [{
      entity: { eid: ORACLE },
      persona: {},
      doc: { title: 'Oracle', body: ORACULAR },
    }],
    ...guide,
    ...memories,
    ...app
      ? [
        ...sources(
          ctx.person,
          app.app.eid,
          'app',
          `${space.slug}/${app.app.slug}: notes and commands`,
          await appEntry(ctx, space, app.app),
        ),
        projected(
          ctx.person,
          app.app.eid,
          link(eid, 'contains', memories[0].entity.eid),
        ),
      ]
      : [],
  ])
  // A private work store may have topics discovered for a different person.
  // Their app and space subjects must not enter this person's topic outline.
  let allowed = new Set(
    topics(ctx.person, all).filter((b) => b.topic).map((b) => b.entity.eid),
  )
  let visible = (b: Bundle) => !b.topic || allowed.has(b.entity.eid)
  let visibility = {
    entity: and(
      or(absent('operator_oracle'), eq('operator_oracle.person', ctx.person)),
    ),
  }
  let view: Graph = {
    ...g,
    read: (q, opts) => g.read(q, { ...opts, visibility }),
    get: async (ids, comps, opts) =>
      (await g.get(ids, comps, { ...opts, visibility })).filter(visible),
  }
  let got = await gather(view)(eid)
  if (!got) throw refuse('missing', 'That topic is gone.')
  return compile(g.vocab)(got)
}

export let topicOf = (b: Bundle | undefined): string | undefined =>
  (b?.session as Comp | undefined)?.topic as string | undefined

export let TOPIC = {
  type: 'string',
  description:
    'Consult the oracle of this app or space topic: its #id from the Oracles map. Supply the question as prompt.',
}
