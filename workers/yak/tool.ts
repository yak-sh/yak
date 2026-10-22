// What a connector tool IS, and the small kit for saying one: the shape of a
// row, what a running tool is handed, and the three questions every row asks
// before it does anything — which space, which app, and is this caller allowed
// there.
//
// It is here rather than in tools.ts because tools.ts is the roster, and a
// domain module contributes rows to it. A domain module that said its
// rows by importing the roster would be a cycle, and a cycle whose first
// symptom is a row half-built at module load. So the contract sits below both:
// tools.ts imports it to say the platform's own rows, connections.ts and views.ts
// import it to say theirs, and neither knows about the other.
//
// Nothing here decides anything a caller could not decide for themselves; it
// is the vocabulary a row is written in.
import type { Security } from '@yaks/mcp'
import { writes } from '@yaks/member'
import { CallError } from '@yaks/tools/errors'
import { fill } from '@yaks/yaml'
import { WORDS } from './content.ts'
import {
  type App,
  appStore,
  daysLeft,
  type Directory,
  META,
  type Space,
} from './directory.ts'
import { bound, type Env } from './env.ts'
import { directory } from './directory.ts'
import * as directoryPart from './directory.ts'
import type { Spend } from './sandbox.ts'
import type { Caller, Who } from './session.ts'
import type { Clock } from './timing.ts'

export type Ctx = {
  env: Env
  dir: Directory
  /** Start a new authorization operation; no standing crosses this boundary. */
  reopen?: () => Directory
  person: string
  /** The invocation whose work a forwarded store call records as its source. */
  call?: string
  // How this caller got in, when a door knows (mcp.ts sets it from
  // identity.ts `asking`): the session, a connector's token, or a CLI grant,
  // with what that credential says about itself. `about` reads it to answer
  // who is asking and until when, and `grant` reads it to refuse minting a
  // grant from a grant. Absent where nobody asked — the builder's own loop
  // runs these tools for a person it already knows (builder.ts).
  who?: Caller
  // Where a caller who has not signed in is calling from (rate.ts `source`),
  // set by the anonymous door (mcp.ts `stranger`) so a tool that holds
  // strangers to a rate has a key to hold them by.
  source?: string
  // The tool list this door is serving and the version naming it (mcp.ts,
  // T-34277). Set after the tools are assembled, since it is made of them, so
  // only a tool running sees it — which `about` is.
  roster?: { version: string; names: string[] }
  // What the apps in reach say about themselves (standing.ts), read when it
  // is asked for, by the door that also puts the roster in
  // `initialize.instructions` (mcp.ts). `about` says it again, because a
  // client that cached the instructions at connect has no other way to read
  // them fresh.
  standing?: () => Promise<string>
  // The container time this build has spent (sandbox.ts `Spend`), where a
  // build is what is running: builder.ts mints one per loop and pays for it
  // at the end. A connector call arrives without one and gets a fresh one, so
  // a single tool call is its own budget — which is as much as one call could
  // spend anyway, since a command is capped at sandbox.ts `TIMEOUT`.
  spend?: Spend
  // Told when a caller who writes has entered a space (`inSpace`, `inApp`),
  // by a door that will tell them what is unseen there once the write is done
  // (agent.ts `answered`), so that reading can begin beside the write
  // (unseen.ts `foresee`).
  ahead?: (space: Space, who: Who) => void
  // The request's stopwatch (timing.ts), when the door keeps one: a write
  // names each round trip it waits on, and mcp.ts puts the marks on the
  // answer as `Server-Timing`, so a slow deploy says which hop was slow.
  clock?: Clock
}

/** Discard only the directory view, never carry its role or app into the next
 * operation. Callers must acquire both again before doing authorized work. */
export let renew = (ctx: Ctx) => {
  if (ctx.reopen) ctx.dir = ctx.reopen()
}

/** This caller at one permission level. A door's verified credential names
 * the instrument; internal callers that name none keep the person's byline. */
export let asCaller = (ctx: Ctx, role: Who['role']): Who => ({
  person: ctx.person,
  role,
  ...(ctx.who?.instrument ? { via: ctx.who.instrument } : {}),
})

export type Args = Record<string, unknown>

// What a tool answers: the text, the space it worked in (so the door can
// append what is unseen there), and, where code has something to read, the
// same answer as data. The text is for a person and may carry more than the
// answer (the unseen block); the value rides beside it as the answer's
// `output{value}` (agent.ts `answered`), which is what a program reads.
export type Out = {
  text: string
  space?: Space
  value?: Record<string, unknown>
}

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
  // What this one does, as the four MCP hints (@yaks/graph `Tool`, emitted by
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
  // What it declares about signing in (`_meta.securitySchemes`), where that is
  // not what the door declares for everything it lists: a tool anybody may
  // call says `noauth` (preauth.ts NOAUTH, mcp.ts signin).
  security?: Security[]
  input: Shape
  run: (ctx: Ctx, args: Args) => Promise<Out>
}

/** What a tool says about itself: one entry of tools.yml, under the tool's own
 * name. The words are the file's; everything else about a row is code's. */
export type Words = { title: string; description: string }

/**
 * A row as it is written: everything but the words. `worded` puts those on,
 * out of tools.yml — the Rails-locale shape of M-34605, where the code refers
 * to a key and the file holds the sentence.
 */
export type Row = Omit<Tool, 'title' | 'description'> & {
  /** what a `{{slot}}` in those words stands for, for the few rows whose
   * description is not a constant — `guide` names the pages there are today. */
  slots?: Record<string, string>
}

/**
 * A row wearing its words. A name tools.yml says nothing about throws at
 * module load, which is the test run, the bundle and the boot — so a row added
 * without its words is a build that fails and never a tool that lists blank.
 */
export let worded = (row: Row): Tool => {
  let said = WORDS[row.name]
  if (!said) throw new Error(`tools.yml says nothing about ${row.name}`)
  let { slots, ...rest } = row
  return {
    ...rest,
    title: said.title,
    description: fill(said.description, slots),
  }
}

/**
 * A refusal: the caller asked for something this tool will not do, and the
 * sentence says why. The runner records it as `refusal{code}` and reports
 * nothing (@yaks/tools `CallError`); anything else a tool throws is a defect,
 * mailed as an incident. The codes are few on purpose: `arguments` (what was
 * passed is malformed), `access` (not this caller's to do), `missing` (no such
 * thing), `conflict` (the thing is not in a state for this), `limit` (a plan,
 * ceiling or rate says no), `unavailable` (switched off where this runs).
 */
export let refuse = (code: string, text: string) => new CallError(code, text)

// The code a store's refusal carries, by its status; a 4xx not named here is
// something malformed in what was asked.
let STATUS: Record<number, string> = {
  401: 'access',
  403: 'access',
  404: 'missing',
  409: 'conflict',
  413: 'limit',
  429: 'limit',
}

/** What a door answered, as a throwable: a 4xx is its refusal of what the
 * caller asked, and anything else is ours to fix. */
export let rejected = (status: number, text: string) =>
  status < 500
    ? refuse(STATUS[status] ?? 'arguments', text)
    : Object.assign(new Error(text), { status })

export let str = (description: string) => ({ type: 'string', description })

// The two arguments nearly every tool takes, so each word here is sent once
// per tool on every listing.
export let SPACE = str(
  'the space slug, as in <space>.yaks.app; if optional and omitted, the ' +
    "space holding the app, else the person's only space",
)

export let APP = str('the app slug, as in <space>.yaks.app/<app>/')

export let text = (v: unknown, what: string) => {
  if (typeof v != 'string' || !v) {
    throw refuse('arguments', `${what} is required`)
  }
  return v
}

// The space the caller means when they name none: the one that is theirs.
// Signing in mints it, so this is one lookup and never a question; a person
// who signed in before that existed, or who was invited into somebody else's
// space before they ever had one, gets theirs on this very call (T-32482,
// T-33142). Belonging to a space is not having one — defaulting to a space
// the caller is only a member of aimed app_install at the inviter's space.
//
// Naming the APP is naming the space — the one they can reach that holds
// that slug, among the spaces they own or have accepted a seat in: an
// invitation not yet accepted is no seat (invite.ts, T-37880), so a stranger's
// space never answers to a name their agent says. An app's own tool (declared.ts) knows its store and asks
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
      // Nor does an app of a space in the trash.
      let here = await ctx.dir.app(space, app)
      if (here && !here.trashed && !space.trashed) holding.push(space)
    }
    if (holding.length == 1) return holding[0]
    if (holding.length > 1) {
      throw refuse(
        'arguments',
        `space: name one of ${
          holding.map((s) => s.slug).join(', ')
        } — each has an app ${app}`,
      )
    }
  }
  let owned = await ctx.dir.spaces(ctx.person, 'owner')
  if (owned.length > 1) {
    throw refuse(
      'arguments',
      `space: name one of ${owned.map((s) => s.slug).join(', ')}`,
    )
  }
  if (owned[0]) return owned[0]
  // The legacy default may mint its space. That internal write uses an
  // authoritative client and starts a new scope before any role is used.
  let space =
    await (ctx.reopen
      ? directory(bound(ctx.env.DIRECTORY, directoryPart.fetch, ctx.env), true)
      : ctx.dir).own(ctx.person)
  if (ctx.reopen) return (await reacquire(ctx, space, undefined, false)).space
  return space
}

// The platform's admin: an owner of the meta space, the seat every platform
// act answers to (sell.ts `fees`, tunnel.ts).
export let admin = async (ctx: Ctx): Promise<boolean> => {
  let meta = await ctx.dir.space(META.space)
  return !!meta && await ctx.dir.role(meta, ctx.person) == 'owner'
}

// The caller's role in a space: their seat's. Where the door says `over` —
// the graph tier naming an app (agent.ts `named`) and reversible app trash
// and restore (tools.ts) — the platform's admin stands as an owner in every
// space. App writes still go through the store's own rules and journal,
// recorded as the admin (T-63550).
let roleIn = async (ctx: Ctx, space: Space, over: boolean) => {
  let role = await ctx.dir.role(space, ctx.person)
  return role != 'owner' && over && await admin(ctx) ? 'owner' : role
}

// The space a call names, or the one it means.
let spaceOf = async (ctx: Ctx, args: Args) => {
  if (args.space != null) return await named(ctx, text(args.space, 'space'))
  let space = await ownSpace(ctx, args.app)
  if (!space) throw refuse('missing', `no space ${args.space}`)
  return space
}

// The space a call names by its address. An assistant remembers a space by
// the name it last used, and where that space went is what its old
// hostname's redirect says to anybody, so the refusal says it too and the
// next call names the space where it lives (D-131924).
let named = async (ctx: Ctx, slug: string) => {
  let space = await ctx.dir.space(slug)
  if (space) return space
  let moved = await ctx.dir.formerly(slug)
  throw refuse(
    'missing',
    `no space ${slug}` +
      (moved ? ` — it moved to ${moved.slug}; name it that` : ''),
  )
}

// The caller in the space: a member reads, an owner or editor writes.
let callerIn = async (
  ctx: Ctx,
  space: Space,
  write: boolean,
  over: boolean,
) => {
  if (
    ctx.who?.spaceEid
      ? ctx.who.spaceEid != space.eid
      : ctx.who?.space && ctx.who.space != space.slug
  ) {
    throw refuse('access', 'this credential does not open that space')
  }
  let who = asCaller(ctx, await roleIn(ctx, space, over))
  if (over && await admin(ctx)) who.administrative = true
  if (!who.role) throw refuse('access', `not a member of ${space.slug}`)
  if (write && !writes(who.role)) {
    throw refuse('access', `not a writer of ${space.slug}`)
  }
  return who
}

// Something in the trash (erase.ts) is asleep: its store answers nothing
// (graph.ts `#sleep`) and its addresses serve nothing, so a door that names
// it says where it is and the call that brings it back, rather than writing
// what nothing will serve or relaying a sleeping store's 404. Only the
// trash's own doors reach past this: app_delete and app_restore for an app
// (`inBin`), space_delete and space_restore for a space (`spaceBin`).
let awake = (space: Space, app?: App) => {
  if (space.trashed) {
    throw refuse(
      'conflict',
      `${space.slug} is in the trash, ${daysLeft(space.trashed)} days ` +
        `left — space_restore(space: '${space.slug}') brings it back`,
    )
  }
  if (app?.trashed) {
    throw refuse(
      'conflict',
      `${space.slug}/${app.slug} is in the trash, ${
        daysLeft(app.trashed)
      } days left — app_restore(space: '${space.slug}', app: ` +
        `'${app.slug}') brings it back`,
    )
  }
}

let seated = async (
  ctx: Ctx,
  args: Args,
  write: boolean,
  over: boolean,
  trash: boolean,
) => {
  let selected: Space | undefined
  for (let attempt = 0;; attempt++) {
    let scope = { ...ctx, dir: ctx.reopen?.() ?? ctx.dir }
    try {
      let space = selected
        ? await scope.dir.at(selected.eid)
        : await spaceOf(scope, args)
      if (!space) throw refuse('missing', 'the selected space no longer exists')
      selected = space
      let who = await callerIn(scope, space, write, over)
      if (write && !trash) awake(space)
      ctx.dir = scope.dir
      if (write) ctx.ahead?.(space, who)
      return { space, who }
    } catch (error) {
      if (!ctx.reopen || attempt >= 2 || !unavailable(error)) throw error
    }
  }
}

export let unavailable = (error: unknown) =>
  error != null && typeof error == 'object' && 'status' in error &&
  error.status === 503

/** Reacquire a held target by identity after a directory commit. This never
 * reruns slug/default selection and returns new metadata, standing and door
 * together. Old doors stay invalid; no effects are retried. */
export let reacquire = async (
  ctx: Ctx,
  previous: Space,
  held?: App,
  write = true,
  over = false,
  trash = false,
) => {
  for (let attempt = 0;; attempt++) {
    let scope = { ...ctx, dir: ctx.reopen?.() ?? ctx.dir }
    try {
      let pair = held ? await scope.dir.appAt(held.eid) : null
      let space = pair?.space ?? await scope.dir.at(previous.eid)
      if (
        !space || space.eid != previous.eid ||
        held && (!pair || pair.app.space != space.eid)
      ) {
        throw refuse('missing', 'the authorized target no longer exists')
      }
      let who = await callerIn(scope, space, write, over)
      let app = pair?.app
      if (!trash) awake(space, app)
      ctx.dir = scope.dir
      return {
        space,
        app,
        who,
        store: app ? appStore(ctx.env.STORE, space, app, ctx.env) : undefined,
      }
    } catch (error) {
      // Only these provisional reads restart. No rights escaped, and no
      // tool, compiler, directory write or Store write is replayed.
      if (!ctx.reopen || attempt >= 2 || !unavailable(error)) throw error
    }
  }
}

// The caller in the space a call names. A write into a space in the trash is
// refused; reading one still answers (app_list says what is in it).
export let inSpace = (ctx: Ctx, args: Args, write = false, over = false) =>
  seated(ctx, args, write, over, false)

/** The caller writing in a space wherever it is, the trash included: the
 * trash's own doors, space_delete and space_restore. */
export let spaceBin = (ctx: Ctx, args: Args) =>
  seated(ctx, args, true, false, true)

// One named space as a seat — the shape `directory.seats` answers in, so a
// listing over one space and a listing over all of them read the same
// (tools.ts `app_list`).
export let seatIn = async (ctx: Ctx, slug: string) => {
  let space = await named(ctx, slug)
  let role = await ctx.dir.role(space, ctx.person)
  if (!role) throw refuse('access', `not a member of ${space.slug}`)
  return [{ space, role }]
}

// The caller's seat and the app are two directory reads with nothing between
// them, so they go together; a refusal of the caller still comes first, and
// the trash next: an app in it, or in a space in it, is refused at every door
// but its own (`awake`).
export let inApp = (ctx: Ctx, args: Args, write = false, over = false) =>
  reached(ctx, args, write, over, false)

/** The app a call names wherever it is, its own trash included: the trash's
 * own doors, app_delete and app_restore. A space in the trash is still
 * refused, since space_restore is what brings its apps back. */
export let inBin = (ctx: Ctx, args: Args, over = false) =>
  reached(ctx, args, true, over, true)

let reached = async (
  ctx: Ctx,
  args: Args,
  write: boolean,
  over: boolean,
  trash: boolean,
) => {
  let selectedSpace: Space | undefined
  let selectedApp: App | undefined
  let slug = text(args.app, 'app')
  for (let attempt = 0;; attempt++) {
    let scope = { ...ctx, dir: ctx.reopen?.() ?? ctx.dir }
    try {
      let space = selectedSpace
        ? await scope.dir.at(selectedSpace.eid)
        : await spaceOf(scope, args)
      if (!space) throw refuse('missing', 'the selected space no longer exists')
      selectedSpace = space
      // Bind identities as soon as a target has been observed. A failed
      // provisional admission never reselects an already observed entity.
      let app = selectedApp
        ? (await scope.dir.appAt(selectedApp.eid))?.app
        : await scope.dir.app(space, slug)
      if (app) selectedApp = app
      // A stranger learns no target existence from a failed admission.
      let who = await callerIn(scope, space, write, over)
      if (!app || app.space != space.eid) {
        throw refuse('missing', `no app ${slug} in ${space.slug}`)
      }
      awake(space, trash ? undefined : app)
      ctx.dir = scope.dir
      if (write) ctx.ahead?.(space, who)
      return {
        space,
        app,
        who,
        store: appStore(ctx.env.STORE, space, app, ctx.env),
      }
    } catch (error) {
      if (!ctx.reopen || attempt >= 2 || !unavailable(error)) throw error
    }
  }
}
