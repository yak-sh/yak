// What the apps a caller can reach say about themselves, said once at the top
// of every agent's context (T-34425). Two things live here, and they are one
// passage:
//
//   DISCOVERY   Owner, 2026-09-05: "is there a mechanism to ensure future
//               agents discover the app? like how the mcp tools are
//               discovered. if i later say, 'add this recipe', i want them to
//               know there's a recipe app to add it to". So every reachable
//               app gets a heading, its address, what it holds and its own
//               tools — an app already made is found instead of made again.
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
import { named, reachable, toolsOf } from './declared.ts'
import type { Ctx } from './tools.ts'
import { appDoc } from './vocab.ts'
import { sha256 } from './versions.ts'

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
  /** the tools it declares, spelled as the door lists them */
  tools: string[]
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
 * The door already walked the reach and already listed the declared tools
 * before it asks for this, so both ride in rather than being read a second
 * time on every call (mcp.ts `door`). A caller with neither — the builder —
 * reads them here.
 */
export let entries = async (
  ctx: Ctx,
  reach?: { space: Space; app: App }[],
  tools?: string[],
): Promise<Entry[]> =>
  await Promise.all(
    (reach ?? await reachable(ctx)).map(async ({ space, app }) => ({
      space,
      app,
      said: await agentsOf(ctx.env, space, app),
      kinds: await kindsOf(ctx.env, space, app),
      // A slug carries no underscore and the first `__` is the seam
      // (declared.ts `named`), so a prefix match is exact.
      tools: tools
        ? tools.filter((t) => t.startsWith(`${app.slug}__`))
        : Object.keys(await toolsOf(ctx.env, space, app))
          .map((t) => named(app, t)),
    })),
  )

// One app's heading and the line under it, then whatever its person wrote.
let entry = (e: Entry): string =>
  `## ${e.space.slug}/${e.app.slug}\n` +
  `${url(e.space, e.app)} — ${e.app.title || e.app.slug}, ${holds(e.kinds)}.` +
  `${e.tools.length ? ` Tools: ${e.tools.join(', ')}.` : ''}` +
  `${e.said ? `\n\n${e.said}` : ''}`

let OPENING = `# The apps here

Every app you can reach, what it holds, and the standing instructions its
person left beside it. When an ask belongs in one of these — another recipe,
another chore, another entry — put it there rather than making a second app
for it, and follow whatever the app says below.`

/**
 * The passage itself, and a MARK naming it. The mark folds into the roster
 * version (mcp.ts), so an app that appeared, an app that changed what it
 * holds, and an edited AGENTS.md all move the version a client cached at
 * connect — and the door says so on the next reply (stream.ts `roster`).
 *
 * A person with no apps gets no passage and no mark: there is nothing to say,
 * and saying it would put a heading with nothing under it at the top of every
 * agent's context.
 */
export let standing = async (
  ctx: Ctx,
  reach?: { space: Space; app: App }[],
  tools?: string[],
): Promise<{ text: string; mark: string; apps: Entry[] }> => {
  let apps = await entries(ctx, reach, tools)
  let text = passage(apps)
  if (!text) return { text, mark: '', apps }
  let mark = await sha256(new TextEncoder().encode(text))
  return { text, mark: mark.slice(0, 16), apps }
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
 * already spoken for, which is the same seam a declared tool takes
 * (declared.ts `named`). An app that can claim neither is left off rather than
 * shadowing something a person already knows by name.
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
