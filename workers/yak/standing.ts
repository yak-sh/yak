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
//   NOTES       A `NOTES.md` beside index.html: what the person wants written
//               down about how that app is kept. Owner, 2026-09-05: "if i
//               make a recipe app, and i often have my agent add the recipes,
//               but i want them to do it in a consistent way (use grams,
//               include amounts of ingredients in instructions, etc), do they
//               have a place to put those instructions so they're always
//               followed for them or other agents that are granted access to
//               the app?"
//
// It is the app's INSIDE, like `vocab.json`, `tools.json` and the seeds
// (apps.ts MANIFEST): written and read through `app_files`, never served to
// the web. An install copies it with the rest of the app's files (tools.ts
// `copied`), so a published app carries its notes to everyone who takes one.
//
// The file was `AGENTS.md` until T-34632 and is still read under that name.
// ChatGPT runs a classifier over a connector's tool text and its `initialize`
// instructions: a passage that named that file and said how a model was to
// treat what it found there reads as prompt injection, and the person got a
// warning about this connector before they had used it once. So the two
// halves are served at different moments. The ROSTER — every app, its address,
// what it holds, its commands — rides on the instructions, where discovery has
// to be. The NOTES are handed over when something asks for them: `about`
// (tools.ts), the prompt a person picks by name, and the builder we run
// ourselves (builder.ts).
//
// BOUNDED, because the notes are read on every call at the door: the file is
// refused over CAP at the write rather than truncated at the read — half of
// what somebody wrote is worse than a pointer to all of it.
import { r2Blobs } from '../../src/blobs_r2.ts'
import { type App, type Space, storeName, url } from './directory.ts'
import { storeOf } from './door.ts'
import type { Env } from './env.ts'
import { at, reachable, toolsOf } from './declared.ts'
import { told } from './memory.ts'
import type { Ctx } from './tools.ts'
import { appDoc } from './vocab.ts'

/** The file, at the app's root. */
export let NOTES = 'NOTES.md'

/** What it was called before T-34632, still read where an app has one. */
export let AGENTS = 'AGENTS.md'

/** Both spellings, newest first — the order `notesOf` reads them in. */
export let NAMES = [NOTES, AGENTS]

/**
 * The most an app's notes may be. Every agent that can reach the app is handed
 * them, so they are the notes themselves and not the reasoning behind them;
 * 4 KB is a page of prose, and a person with more to say than that is writing
 * a guide rather than a note.
 */
export let CAP = 4096

let root = (path: string) => path.replace(/^\/+/, '')

/**
 * Why this write is refused, or '' when it is fine — the ceiling said with the
 * number, so an agent that wrote too much knows by how much.
 *
 * ```ts
 * tooLong('NOTES.md', 5000) // 'NOTES.md is 5000 bytes — 4096 at most. …'
 * ```
 */
export let tooLong = (path: string, n: number): string =>
  NAMES.includes(root(path)) && n > CAP
    ? `${root(path)} is ${n} bytes — ${CAP} at most. Every agent that can ` +
      "reach the app is handed it, so keep it to the app's own notes, not " +
      'the reasoning behind them.'
    : ''

/** One app, as the passage says it. */
export type Entry = {
  space: Space
  app: App
  /** its NOTES.md, or '' */
  said: string
  /** the components its vocab.json declares */
  kinds: string[]
  /** the commands it declares, as `command` takes them (declared.ts) */
  commands: string[]
}

/**
 * One app's notes, or '' where it has none — `NOTES.md`, falling back to the
 * `AGENTS.md` an app written before T-34632 still carries. Nothing migrates:
 * the old file goes on working where it sits, and an app that has both is the
 * newer name.
 */
export let notesOf = async (
  env: Env,
  space: Space,
  app: App,
): Promise<string> => {
  let blobs = r2Blobs(env.BLOBS)
  // Both names at once, not one and then the other: this runs per app on
  // every call at the door, and most apps have notes under NEITHER name — so
  // asking in turn would put a second round trip on the common case. `read`
  // rather than has-then-get for the same reason.
  let both = await Promise.all(
    NAMES.map((name) => blobs.read(`${space.slug}/${app.slug}/${name}`)),
  )
  let bytes = both.find(Boolean)
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
      said: await notesOf(ctx.env, space, app),
      kinds: await kindsOf(ctx.env, space, app),
      // The commands the door already listed, picked out by the app they are
      // of — `<space>/<app>`, which is the same word `command` takes.
      commands: commands
        ? commands.filter((c) => c.at == at(space, app)).map((c) => c.name)
        : Object.keys(await toolsOf(ctx.env, space, app)),
    })),
  )

/** The line an app with notes gets on the roster, in place of them. */
export let HAS_NOTES = 'Keeps notes of its own, which about hands over.'

// One app's heading and the line under it — then either its notes, or a line
// saying it has some. The roster is the half that rides on the instructions,
// so what an app's person wrote appears only where something asked for it.
let entry = (e: Entry, notes: boolean): string =>
  `## ${e.space.slug}/${e.app.slug}\n` +
  `${url(e.space, e.app)} — ${e.app.title || e.app.slug}, ${holds(e.kinds)}.` +
  `${e.commands.length ? ` Commands: ${e.commands.join(', ')}.` : ''}` +
  `${e.said ? notes ? `\n\n${e.said}` : ` ${HAS_NOTES}` : ''}`

let OPENING = `# The apps here

Every app you can reach, its address and what it holds. An ask that belongs in
one of these — another recipe, another chore, another entry — has somewhere to
go already, rather than a second app for the same thing.

An app's own verbs are COMMANDS, not tools of this list: run one with the
command tool — the app, the command's name, and its arguments as args — and
the commands tool says which there are and what each one takes.

Some apps keep notes of their own about how they are kept: the about tool
returns them, along with anything the person has said here.`

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
 * The passage, in its two lengths, and the apps it was made of.
 *
 * `text` is the ROSTER — every app, its address, what it holds, its commands
 * — and it is what rides on the `initialize` instructions, where an app made
 * this morning has to be named or it is made a second time this afternoon.
 * `notes` is that same roster with what each app's person wrote under it and
 * what they have said in this space, and it is what `about` hands over when
 * something asks. Both are said fresh on every call at the door rather than
 * named by a mark the client compares (T-34541).
 *
 * A person with no apps gets no roster: there is nothing to say, and saying it
 * would put a heading with nothing under it at the top of every agent's
 * context.
 */
export let standing = async (
  ctx: Ctx,
  reach?: { space: Space; app: App }[],
  commands?: { at: string; name: string }[],
): Promise<{ text: string; notes: string; apps: Entry[] }> => {
  let apps = await entries(ctx, reach, commands)
  return {
    text: passage(apps),
    notes: [passage(apps, true), ...await heard(ctx)].filter(Boolean)
      .join('\n\n'),
    apps,
  }
}

/** The apps as one passage, or '' where there are none. */
export let passage = (apps: Entry[], notes = false): string =>
  apps.length
    ? `${OPENING}\n\n${apps.map((e) => entry(e, notes)).join('\n\n')}`
    : ''

/**
 * The prompts a person picks by name (mcp.ts): one per app that keeps notes,
 * so somebody can say "the recipes notes" out loud without asking an agent to
 * go and read a file. The notes are the prompt's TEXT, which is fetched by
 * name; the listing says only that the app has some, because a prompt list is
 * read by the same classifier the tool list is (T-34632) and somebody else's
 * words are not ours to put in front of it.
 *
 * The name is the app's slug — host-safe, since a slug is `[a-z0-9-]` and the
 * door's own prompts are letters and hyphens — and `<app>__notes` where that
 * word is
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
    let name = [e.app.slug, `${e.app.slug}__notes`].find((n) => !held.has(n))
    if (!name) continue
    held.add(name)
    let title = e.app.title || e.app.slug
    out.push({
      name,
      title: `${title}: notes`,
      description: `The notes kept beside the ${title} app.`,
      text: e.said,
    })
  }
  return out
}
