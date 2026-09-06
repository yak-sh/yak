// What the apps a caller can reach say about themselves, said once at the top
// of every agent's context (T-34425). Two things live here, and they are one
// passage:
//
//   DISCOVERY   Owner, 2026-09-05: "is there a mechanism to ensure future
//               agents discover the app? like how the mcp tools are
//               discovered. if i later say, 'add this recipe', i want them to
//               know there's a recipe app to add it to". So every reachable
//               app gets a heading, its address, what it holds and its own
//               commands — an app already made is found instead of made again.
//   STANDING    An `AGENTS.md` beside index.html: the rules the person wants
//               followed whenever anyone works on or with that app. Owner,
//               2026-09-05: "if i make a recipe app, and i often have my agent
//               add the recipes, but i want them to do it in a consistent way
//               (use grams, include amounts of ingredients in instructions,
//               etc), do they have a place to put those instructions so
//               they're always followed for them or other agents that are
//               granted access to the app?"
//
// It is the app's INSIDE, like `vocab.json`, `tools.json` and the seeds
// (apps.ts MANIFEST): written and read through `app_files`, never served to
// the web. An install copies it with the rest of the app's files (tools.ts
// `copied`), so a published app carries its rules to everyone who takes one.
//
// Three doors read this passage, so a rule cannot be followed at one and
// missed at another: the connector's `initialize` instructions and its
// signed-in `about` (mcp.ts), the prompts a PERSON picks by name (mcp.ts
// `extend`), and the builder we run ourselves (builder.ts).
//
// BOUNDED, because it is paid for on every connection: an app with no
// AGENTS.md is one line, and the file itself is refused over CAP at the write
// rather than truncated at the read — an instruction cut in half is worse than
// one that was never written.
import { r2Blobs } from '../../src/blobs_r2.ts'
import { type App, type Space, storeName, url } from './directory.ts'
import { storeOf } from './door.ts'
import type { Env } from './env.ts'
import { at, reachable, toolsOf } from './declared.ts'
import { told } from './memory.ts'
import type { Ctx } from './tools.ts'
import { appDoc } from './vocab.ts'

/** The file, at the app's root. */
export let AGENTS = 'AGENTS.md'

/**
 * The most an app's standing instructions may be. Every agent that can reach
 * the app reads them on every connection, so they are the rules and not the
 * reasoning; 4 KB is a page of prose, and a person with more to say than that
 * is writing a guide rather than a standing rule.
 */
export let CAP = 4096

let root = (path: string) => path.replace(/^\/+/, '')

/**
 * Why this write is refused, or '' when it is fine — the ceiling said with the
 * number, so an agent that wrote too much knows by how much.
 *
 * ```ts
 * tooLong('AGENTS.md', 5000) // 'AGENTS.md is 5000 bytes — 4096 at most. …'
 * ```
 */
export let tooLong = (path: string, n: number): string =>
  root(path) == AGENTS && n > CAP
    ? `${AGENTS} is ${n} bytes — ${CAP} at most. It is read on every ` +
      'connection by every agent that can reach the app, so keep it to the ' +
      'rules themselves, not the reasoning behind them.'
    : ''

/** One app, as the passage says it. */
export type Entry = {
  space: Space
  app: App
  /** its AGENTS.md, or '' */
  said: string
  /** the components its vocab.json declares */
  kinds: string[]
  /** the commands it declares, as `command` takes them (declared.ts) */
  commands: string[]
}

/** One app's AGENTS.md, or '' where it has none. */
export let agentsOf = async (
  env: Env,
  space: Space,
  app: App,
): Promise<string> => {
  // `read` rather than has-then-get: most apps have no AGENTS.md, and this
  // runs once per app on every call at the door.
  let bytes = await r2Blobs(env.BLOBS).read(
    `${space.slug}/${app.slug}/${AGENTS}`,
  )
  if (!bytes) return ''
  // The write refuses anything over CAP, so this slice only ever catches a
  // file written before the ceiling existed.
  return new TextDecoder().decode(bytes).slice(0, CAP).trim()
}

// The words an app declares as its own, as the store last accepted them
// (reach.ts `vocabAt` reads the same door for the same file). A store that
// cannot answer says nothing, which reads as an app with no words of its own.
let kindsOf = async (env: Env, space: Space, app: App): Promise<string[]> => {
  let r = await storeOf(env.STORE, storeName(space, app))('/vocab')
  if (!r.ok) {
    await r.body?.cancel()
    return []
  }
  try {
    return Object.keys(appDoc(await r.json()).$defs ?? {})
  } catch {
    return []
  }
}

// A component name as a person would say the things it holds. English enough
// for a sentence and no more: a wrong plural costs a reader nothing, and a
// dictionary would cost every connection.
let many = (word: string) =>
  /[sxz]$|[cs]h$/.test(word)
    ? `${word}es`
    : /[^aeiou]y$/.test(word)
    ? `${word.slice(0, -1)}ies`
    : `${word}s`

// What an app holds, in words. An app that declares nothing of its own still
// holds the platform's `doc` — a title and a body — which is what most first
// apps are made of.
let holds = (kinds: string[]) =>
  `holds ${(kinds.length ? kinds : ['doc']).map(many).join(', ')}`

/**
 * Every app the caller can reach, with what it says about itself.
 *
 * The door already walked the reach and already listed the commands before it
 * asks for this, so both ride in rather than being read a second time on every
 * call (mcp.ts `door`). A caller with neither — the builder — reads them here.
 */
export let entries = async (
  ctx: Ctx,
  reach?: { space: Space; app: App }[],
  commands?: { at: string; name: string }[],
): Promise<Entry[]> =>
  await Promise.all(
    (reach ?? await reachable(ctx)).map(async ({ space, app }) => ({
      space,
      app,
      said: await agentsOf(ctx.env, space, app),
      kinds: await kindsOf(ctx.env, space, app),
      // The commands the door already listed, picked out by the app they are
      // of — `<space>/<app>`, which is the same word `command` takes.
      commands: commands
        ? commands.filter((c) => c.at == at(space, app)).map((c) => c.name)
        : Object.keys(await toolsOf(ctx.env, space, app)),
    })),
  )

// One app's heading and the line under it, then whatever its person wrote.
let entry = (e: Entry): string =>
  `## ${e.space.slug}/${e.app.slug}\n` +
  `${url(e.space, e.app)} — ${e.app.title || e.app.slug}, ${holds(e.kinds)}.` +
  `${e.commands.length ? ` Commands: ${e.commands.join(', ')}.` : ''}` +
  `${e.said ? `\n\n${e.said}` : ''}`

let OPENING = `# The apps here

Every app you can reach, what it holds, and the standing instructions its
person left beside it. When an ask belongs in one of these — another recipe,
another chore, another entry — put it there rather than making a second app
for it, and follow whatever the app says below.

An app's own verbs are COMMANDS, not tools of this list: run one with the
command tool — the app, the command's name, and its arguments as args — and
the commands tool says which there are and what each one takes.`

// What the person has SAID, one section per space they belong to (memory.ts,
// T-34474). It rides here rather than beside it because it is the same
// passage: what an agent is handed before it has been told anything, so a
// preference said once is followed after. A space with no memories says
// nothing.
//
// The spaces are the person's own rather than the reach's, because a memory
// belongs to a space and not to an app — somebody with no apps yet has still
// said how they want the first one built.
let heard = async (ctx: Ctx): Promise<string[]> => {
  let spaces = await ctx.dir.spaces(ctx.person)
  return (await Promise.all(spaces.map((s) => told(ctx.env, s))))
    .filter(Boolean)
}

/**
 * The passage itself, and the apps it was made of.
 *
 * It is said fresh on every call at the door rather than named by a mark the
 * client compares (T-34541): the roster it used to fold into moves only when
 * the platform is released now, and an app made this morning is news the
 * INSTRUCTIONS carry at the next connection and `about` says any time.
 *
 * A person with no apps and nothing said gets no passage: there is nothing to
 * say, and saying it would put a heading with nothing under it at the top of
 * every agent's context.
 */
export let standing = async (
  ctx: Ctx,
  reach?: { space: Space; app: App }[],
  commands?: { at: string; name: string }[],
): Promise<{ text: string; apps: Entry[] }> => {
  let apps = await entries(ctx, reach, commands)
  return {
    text: [passage(apps), ...await heard(ctx)].filter(Boolean).join('\n\n'),
    apps,
  }
}

/** The apps as one passage, or '' where there are none. */
export let passage = (apps: Entry[]): string =>
  apps.length ? `${OPENING}\n\n${apps.map(entry).join('\n\n')}` : ''

// The line a person reads on the menu: the file's own first line, with the
// heading marks off it, since an AGENTS.md all but always opens with one.
let first = (said: string) =>
  said.split('\n').map((l) => l.replace(/^#+\s*/, '').trim())
    .find((l) => l.length > 0) ?? ''

/**
 * The prompts a person picks by name (mcp.ts): one per app that left standing
 * instructions, so somebody can say "the recipes rules" out loud without
 * asking an agent to go and read a file.
 *
 * The name is the app's slug — host-safe, since a slug is `[a-z0-9-]` and the
 * door's own prompts are `[a-z]+` — and `<app>__agents` where that word is
 * already spoken for; an app slug carries no underscore, so the first `__` is
 * the seam and nothing else can be. An app that can claim neither is left off
 * rather than shadowing something a person already knows by name.
 */
export let prompted = (apps: Entry[], taken: string[]) => {
  let held = new Set(taken)
  let out: {
    name: string
    title: string
    description: string
    text: string
  }[] = []
  for (let e of apps) {
    if (!e.said) continue
    let name = [e.app.slug, `${e.app.slug}__agents`].find((n) => !held.has(n))
    if (!name) continue
    held.add(name)
    out.push({
      name,
      title: `${e.app.title || e.app.slug}: standing instructions`,
      description: first(e.said) ||
        `What ${e.app.title || e.app.slug} asks of an agent working on it.`,
      text: e.said,
    })
  }
  return out
}
