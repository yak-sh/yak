// What a connector tool IS, and the small kit for saying one: the shape of a
// row, what a running tool is handed, and the three questions every row asks
// before it does anything — which space, which app, and is this caller allowed
// there.
//
// It is here rather than in tools.ts because tools.ts is the ROSTER, and a
// plugin (plugin.ts) contributes rows to it. A domain module that said its
// rows by importing the roster would be a cycle, and a cycle whose first
// symptom is a row half-built at module load. So the contract sits below both:
// tools.ts imports it to say the platform's own rows, memory.ts and views.ts
// import it to say theirs, and neither knows about the other.
//
// Nothing here decides anything a caller could not decide for themselves; it
// is the vocabulary a row is written in.
import type { Security } from '@yaks/mcp'
import { writes } from '@yaks/member'
import { appStore, type Directory, type Space } from './directory.ts'
import type { Env } from './env.ts'
import type { Spend } from './sandbox.ts'
import type { Caller, Who } from './session.ts'

export type Ctx = {
  env: Env
  dir: Directory
  person: string
  // How this caller got in, when a door knows (mcp.ts sets it from
  // identity.ts `asking`): the session, a connector's token, or a CLI grant,
  // with what that credential says about itself. `about` reads it to answer
  // who is asking and until when, and `grant` reads it to refuse minting a
  // grant from a grant. Absent where nobody asked — the builder's own loop
  // runs these tools for a person it already knows (builder.ts).
  who?: Caller
  // The tool list this door is serving and the version naming it (mcp.ts,
  // T-34277). Set after the tools are assembled, since it is made OF them, so
  // only a tool RUNNING sees it — which `about` is.
  roster?: { version: string; names: string[] }
  // What the apps in reach say about themselves (standing.ts), assembled once
  // per request by the door that also puts it in `initialize.instructions`
  // (mcp.ts). `about` says it again, because a client that cached the
  // instructions at connect has no other way to read them fresh.
  standing?: string
  // The container time this BUILD has spent (sandbox.ts `Spend`), where a
  // build is what is running: builder.ts mints one per loop and pays for it
  // at the end. A connector call arrives without one and gets a fresh one, so
  // a single tool call is its own budget — which is as much as one call could
  // spend anyway, since a command is capped at sandbox.ts `TIMEOUT`.
  spend?: Spend
}

export type Args = Record<string, unknown>

// What a tool answers: the text, the space it worked in (so the door can
// append what is unseen there), and, for a tool with a view, the same answer
// as data — the host hands it to the iframe as the result's
// structuredContent (mcp.ts, MCP Apps spec §Notifications).
export type Out = { text: string; space?: Space; data?: unknown }

export type Shape = {
  type: 'object'
  properties: Record<string, unknown>
  required?: string[]
}

export type Tool = {
  name: string
  // A short human title — a noun phrase, not a sentence. Both connector
  // directories require one on every tool, and a person picking through a
  // permission prompt reads it instead of the snake_case name.
  title: string
  description: string
  // The `ui://` resource that draws this tool's answer, if it has one.
  view?: string
  // What this one DOES, as the four MCP hints (@yaks/graph `Tool`, emitted by
  // @yaks/mcp `annotated`). A host reads them to decide what it may call
  // without asking, so they say what the tool does and not what would be
  // convenient: readOnly for a pure look-up, destructive for what deletes or
  // cannot be undone, idempotent for a setter that converges, openWorld for
  // anything reaching past yaks.app. A write that says nothing is taken to be
  // destructive, so silence can only ever tighten a prompt.
  readOnly?: boolean
  destructive?: boolean
  idempotent?: boolean
  openWorld?: boolean
  // What its `data` is shaped like, when it answers a value beside its words.
  // JSON Schema, like `input` — agent.ts turns both into the Zod the MCP SDK
  // wants, so nothing here depends on a validation library.
  output?: Shape
  // Who may call it (MCP Apps §Tools, `_meta.ui.visibility`): the model
  // always; add 'app' for a tool a view's own button calls back through the
  // host, which the host refuses for any tool that does not say so.
  visibility?: ('model' | 'app')[]
  // What it declares about signing in (`_meta.securitySchemes`), where that is
  // not what the door declares for everything it lists: a tool anybody may
  // call says `noauth` (preauth.ts NOAUTH, mcp.ts SIGNIN).
  security?: Security[]
  input: Shape
  run: (ctx: Ctx, args: Args) => Promise<Out>
}

export let str = (description: string) => ({ type: 'string', description })

export let SPACE = str(
  "the space slug — <space>.yaks.app. Leave it out: the person's own space " +
    'is used, and where you name an app, the space is whichever of theirs ' +
    'holds it. Name one only when a refusal asks you to',
)

export let APP = str('the app slug within the space')

export let text = (v: unknown, what: string) => {
  if (typeof v != 'string' || !v) throw new Error(`${what} is required`)
  return v
}

// The space the caller means when they name none: the one that is THEIRS.
// Signing in mints it, so this is one lookup and never a question; a person
// who signed in before that existed, or who was invited into somebody else's
// space before they ever had one, gets theirs on this very call (T-32482,
// T-33142). Belonging to a space is not having one — defaulting to a space
// the caller is only a member of aimed app_install at the INVITER's space.
//
// Naming the APP is naming the space — the one they can reach that holds
// that slug. An app's own tool (declared.ts) knows its store and asks
// nothing, so the generic tier asking a member of two spaces to also name
// one read as the platform forgetting what it had just been told (C-32730
// item 6). Two spaces holding the same slug is the one genuine question, and
// only then are the names said.
export let ownSpace = async (ctx: Ctx, app?: unknown) => {
  if (typeof app == 'string' && app) {
    let holding: Space[] = []
    for (let space of await ctx.dir.spaces(ctx.person)) {
      // An app in the trash does not hold its slug against a live one
      // (erase.ts, T-34430): it answers nothing anywhere else, and a person
      // who deleted their `garden` should not be asked which garden they
      // meant. It is still reachable by naming its space, which is what
      // `app_restore` says when two of them spell one slug.
      let here = await ctx.dir.app(space, app)
      if (here && !here.trashed) holding.push(space)
    }
    if (holding.length == 1) return holding[0]
    if (holding.length > 1) {
      throw new Error(
        `space: name one of ${
          holding.map((s) => s.slug).join(', ')
        } — each has an app ${app}`,
      )
    }
  }
  let owned = await ctx.dir.spaces(ctx.person, 'owner')
  if (owned.length > 1) {
    throw new Error(
      `space: name one of ${owned.map((s) => s.slug).join(', ')}`,
    )
  }
  return owned[0] ?? await ctx.dir.own(ctx.person)
}

// The caller in the space: a member reads, an owner or editor writes.
export let inSpace = async (ctx: Ctx, args: Args, write = false) => {
  let space = args.space == null
    ? await ownSpace(ctx, args.app)
    : await ctx.dir.space(text(args.space, 'space'))
  if (!space) throw new Error(`no space ${args.space}`)
  let who: Who = {
    person: ctx.person,
    role: await ctx.dir.role(space, ctx.person),
  }
  if (!who.role) throw new Error(`not a member of ${space.slug}`)
  if (write && !writes(who.role)) {
    throw new Error(`not a writer of ${space.slug}`)
  }
  return { space, who }
}

export let inApp = async (ctx: Ctx, args: Args, write = false) => {
  let { space, who } = await inSpace(ctx, args, write)
  let slug = text(args.app, 'app')
  let app = await ctx.dir.app(space, slug)
  if (!app) throw new Error(`no app ${slug} in ${space.slug}`)
  return {
    space,
    app,
    who,
    store: appStore(ctx.env.STORE, space, app),
  }
}
