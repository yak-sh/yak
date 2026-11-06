// Topics live beside the Operator's work, on the eids of the spaces and apps
// they describe. Source documents are refreshed when consulted; the contents
// an oracle keeps are never replaced by discovery.
import { addressed, type Bundle, type Comp, type Graph } from '@yaks/graph'
import { derivedEid } from '@yaks/graph/identity'
import { link } from '@yaks/edge'
import { short } from '@yaks/id'
import { compile, gather, named, ORACLE } from '@yaks/topic'
import { safe } from '@yaks/text'
import { inReach } from './declared.ts'
import { type App, type Space, url } from './directory.ts'
import { instructions } from './guide.ts'
import { told } from './memory.ts'
import { type Declared, moved } from './operator-persona.ts'
import { entries, listed, passage } from './standing.ts'
import { type Ctx, refuse } from './tool.ts'

export let oracular: Declared = {
  key: 'platform',
  title: 'yaks.app',
  body:
    "yaks.app builds, hosts and shares web apps. Each space and app is a topic with an oracle. The map below names the topics you can reach. In the person's conversation, fork for work and let the fork consult the oracles it needs; never consult one yourself. In a work fork or helper, ask an oracle with spawn({topic: '<#id from the map>', prompt: '<question>'}); its answer comes back to you automatically. Consult the space for its preferences and the app for its notes before working there. An oracle wears its own persona and opens on that topic's context, using @yaks/topic. Report the result to the conversation in a few lines.",
}

let ORACULAR =
  "You are the oracle of the topic below. Answer questions from its cover, contents and sources. When they do not answer the question, read the app or space through your tools. Distinguish what you read from what you infer, and say when you do not know. Keep the topic accurate: when you learn something missing, rewrite its content.body through graph_apply with self true, the topic's #id and the $was token supplied below. Keep sources current; an app's notes and a space's memories outrank an older summary. Your final answer goes to the fork that asked you, which reports to the person. For another subject consult its oracle with spawn and topic. Your own graph is read or written with self true; app tools reach the apps as usual."

let keep = async (g: Graph, wanted: Bundle[]) => {
  let held = await g.get(wanted.map((b) => b.entity.eid))
  let writes = moved(held, wanted)
  if (writes.length) await g.apply(writes, { trusted: true })
}

let topic = (eid: string, title: string, body: string): Bundle => ({
  entity: { eid },
  topic: { name: named(title) },
  doc: { title, body },
})

let source = (from: string, key: string, title: string, body: string) => {
  let eid = derivedEid(`operator-oracle|${key}|${from}`)
  return [
    { entity: { eid }, doc: { title, body } },
    link(from, 'contains', eid),
  ]
}

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

let topics = ({ spaces, apps }: Subjects): Bundle[] => [
  ...spaces.map((s) =>
    topic(s.eid, s.slug, `The space ${s.slug}: ${s.title}.`)
  ),
  ...apps.flatMap(({ space, app }) => [
    topic(
      app.eid,
      `${space.slug}/${app.slug}`,
      `${app.title || app.slug}. ${url(space, app)}`,
    ),
    link(space.eid, 'contains', app.eid),
  ]),
]

/** The short map shared by a conversation and its work forks. No app notes,
 * memories, vocabularies or connector guide are read for it. */
export let oracleMap = async (ctx: Ctx, g: Graph): Promise<string> => {
  let all = await subjects(ctx)
  await keep(g, topics(all))
  return [
    '## Oracles',
    ...all.spaces.flatMap((s) => [
      `- ${short(s.eid)} space ${safe(s.slug)}: ${safe(s.title)}`,
      ...all.apps.filter((a) => a.space.eid == s.eid).map(({ app }) =>
        `  - ${short(app.eid)} app ${safe(s.slug + '/' + app.slug)}: ${
          safe(app.title)
        }`
      ),
    ]),
  ].join('\n')
}

/** The topic an oracle is asked about, by the `#id` the map names it with
 * (or its eid), resolved as the Operator's own graph resolves any id. */
export let oracleTopic = async (ctx: Ctx, g: Graph, said: string) => {
  await keep(g, topics(await subjects(ctx)))
  let [eid] = await addressed(g, [said])
  return eid
}

/** Refresh only this oracle's sources, then use the topic package's context
 * compiler. Discovery never overwrites the oracle's learned contents. */
export let oracleContext = async (ctx: Ctx, g: Graph, eid: string) => {
  let all = await subjects(ctx)
  let app = all.apps.find((a) => a.app.eid == eid)
  let space = all.spaces.find((s) => s.eid == (app?.space.eid ?? eid))
  if (!space || (!app && space.eid != eid)) {
    throw refuse('access', 'That topic is outside your reach.')
  }
  let memories = source(
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
    ...topics(all),
    ...persona ? [] : [{
      entity: { eid: ORACLE },
      persona: {},
      doc: { title: 'Oracle', body: ORACULAR },
    }],
    ...guide,
    ...memories,
    ...app
      ? [
        ...source(
          eid,
          'app',
          `${space.slug}/${app.app.slug}: notes and commands`,
          passage(await entries(ctx, listed(ctx, [app])), true, ctx.env),
        ),
        link(eid, 'contains', memories[0].entity.eid),
      ]
      : [],
  ])
  // A private work store may have topics discovered for a different person.
  // Their app and space subjects must not enter this person's topic outline.
  let allowed = new Set(
    topics(all).filter((b) => b.topic).map((b) => b.entity.eid),
  )
  let visible = (b: Bundle) => !b.topic || allowed.has(b.entity.eid)
  let view = {
    ...g,
    get: async (...args: Parameters<Graph['get']>) =>
      (await g.get(...args)).filter(visible),
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
