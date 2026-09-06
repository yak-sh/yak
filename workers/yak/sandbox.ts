// The builder's workbench (T-34264): a container it can run commands in, so
// the things a browser cannot compile get compiled somewhere and the artifact
// is shipped into the app as ordinary files.
//
// Owner, 2026-09-05: "and can we also give the agent some sandbox tools so
// they could compile rust, etc. if they needed to?"
//
// ONE SANDBOX PER BUILD SESSION, and a build session is a SPACE — the same key
// the builder's conversation is held under (T-34240), so a person talking to
// the builder and the same person's own agent over the connector reach one
// workbench rather than two. It is a Cloudflare Container behind a Durable
// Object (`@cloudflare/sandbox`), which the deploy provisions from the
// Dockerfile beside this file: Cloudflare's own sandbox image plus pinned
// Rust, Python, Go and Zig toolchains — `zig cc` is the C and C++ path to
// wasm — and `wasm-bindgen` and `wasm-opt` beside them. Nothing rarer than
// those, because an image is disk, disk is money, and every megabyte of it is
// pulled before the first command runs; a build that wants something else
// installs it for the session with apt or a download, and the container it
// installed into is destroyed at the end of that build (T-34516).
//
// THE BINDING IS TYPED, NEVER IMPORTED, the way every other binding in this
// kernel is (env.ts). @cloudflare/sandbox is a Worker package: it imports
// `cloudflare:workers`, which Deno cannot LOAD, so a value import here would
// take every test that reaches a tool down with it. The one place its name
// appears as a value is index.ts, where the deploy needs the Durable Object
// class and no test ever looks. What that costs is the two lines of
// `getSandbox` we actually use — the object per name and the idle timeout —
// spelled below beside the SDK function each mirrors.
//
// WHAT IT COSTS, AND WHO SAYS SO. A container bills for the wall time it is
// awake, so the seconds counted here are the seconds from the FIRST sandbox
// call in a build to the moment the build lets it go ({@link Spend}) — the
// figure Cloudflare bills on, not a sum of command durations. Past
// {@link BUDGET} the tools refuse in a sentence, the way every other ceiling
// on this platform refuses (meter.ts): the person reading it asked for an app,
// not for a stack trace. The month's seconds land on `meter.seconds`
// (meter.ts `countedSandbox`) — its own column beside `tokens`, because a
// token and a container-second are priced differently and one number made of
// both is a number nobody can add up.
//
// WHAT KEEPS IT FROM RUNNING FOREVER: the build destroys it when it ends, and
// {@link SLEEP} is the backstop for a build that never says so — the container
// sleeps on its own after that long idle, which is where the billing stops.
// A sleeping sandbox wakes with its files still there.
//
// AND IT IS SIGNED IN AS THE CALLER (T-34387). Every command runs with
// `YAKS_TOKEN` and `YAKS_HOST` in its environment — a grant (grants.ts),
// narrowed to this space and living about as long as the container can — so
// the `yaks` CLI the image carries, and plain `curl`, reach the platform's own
// door as the person whose build this is. One grant per CONTAINER rather than
// one per command ({@link signed}), and it dies with the container
// ({@link destroyed}). It rides the SDK's per-invocation env and is never
// exported into a shell, so nothing puts it in the builder's transcript.
import type { Space } from './directory.ts'
import { type Grant, ledger, mint, tokenOf } from './grants.ts'
import { PLATFORM } from './route.ts'

/** One sandbox, as this file asks for it — the four things the tools do,
 * plus the one knob the deploy has no way to set. */
export type Box = {
  exec(
    cmd: string,
    opts?: { cwd?: string; timeout?: number; env?: Record<string, string> },
  ): Promise<{ stdout: string; stderr: string; exitCode: number }>
  writeFile(
    path: string,
    content: string,
    opts?: { encoding?: string },
  ): unknown
  readFile(
    path: string,
    opts?: { encoding?: string },
  ): Promise<{ content: string }>
  destroy(): Promise<unknown>
  setSleepAfter?(after: string): unknown
}

/** The `SANDBOX` binding: a Durable Object namespace handing out one by name. */
export type Sandboxes = {
  idFromName(name: string): unknown
  get(id: unknown): Box
}

/**
 * The container time one build has spent, and when it started spending it.
 * `since` is null until the first sandbox call: a build that never reaches
 * for the workbench costs nothing and counts nothing.
 *
 * It is a mutable object on purpose — the tools that spend it are rows in the
 * platform table (tools.ts) and the build that pays for it is the loop
 * (builder.ts), and this is the one thing they share.
 */
export type Spend = {
  since: number | null
  // The grant this build's commands run under, asked for once and awaited by
  // every command after ({@link signed}). It sits here rather than in a
  // closure because it belongs to the build, exactly as the seconds do.
  signing?: Promise<Record<string, string>>
}

export let spending = (): Spend => ({ since: null })

/** The seconds a build has held the container awake, rounded up — and never
 * zero once it has one, because a container that woke at all cost more than a
 * second of somebody's machine to start. */
export let seconds = (s: Spend, now = Date.now()) =>
  s.since == null ? 0 : Math.max(1, Math.ceil((now - s.since) / 1000))

/** The most container time one build may spend. Ten minutes is a Rust
 * release build with room to spare, and a runaway loop stopped well before
 * it costs anything anybody would notice. */
export let BUDGET = 600

/** How long an idle sandbox stays awake, in seconds and in the spelling the
 * SDK takes. The build normally destroys its own; this is what catches the
 * build that never got to say so. */
export let NAP = 300
export let SLEEP = `${NAP / 60}m`

/** The longest one command may run. Nothing here is interactive, and a
 * command that has not finished in four minutes is a command that is stuck. */
export let TIMEOUT = 240_000

/** Where a command runs unless it says otherwise — the sandbox's own
 * writable directory. */
export let CWD = '/workspace'

/** The most output one command hands back. A compiler that failed says why in
 * its first lines; the rest is the same warning again. */
export let CAP = 8_000

/** Where the `yaks` CLI and `curl` inside the container aim: this platform as
 * a whole origin, since what a script pastes into curl is `$YAKS_HOST/mcp`. */
export let HOST = `https://${PLATFORM}`

/** How long the grant in the container's environment lives, in hours: the
 * whole build budget plus the nap that outlasts it, so the token is alive for
 * as long as anything in the container could still be running and dead soon
 * after. Well under the day grants.ts allows at most. */
export let LIFE = (BUDGET + NAP) / 3600

/** No container bound here — the workerd probes and `deno test`, where the
 * binding does not exist. Said as a sentence, because a model reads it. */
export let NO_BOX =
  'No sandbox is running here: the workbench is a Cloudflare Container and ' +
  'this runtime has none. Write the app in files a browser runs — html, css ' +
  'and js — and nothing needs compiling.'

/** Past the budget. It says what is already built is built, the way every
 * other end of a build says it (builder.ts). */
export let overBudget = (spent: number) =>
  `I have had the workbench running for ${spent} seconds, and one build gets ` +
  `${BUDGET}. Whatever is already shipped into the app is shipped — ask me ` +
  'again and I will pick it up with a fresh one.'

/** This build session's container, by name — the id the object is addressed
 * by, and the name its grant is written down under. The space's EID rather
 * than its slug: a slug is renamed and an eid is not, and a workbench that
 * followed a rename to a fresh container would lose the half-built tree
 * inside it. */
export let named = (space: Space) => `build-${space.eid}`

// The object holding it. This is @cloudflare/containers `getContainer`, which
// is all `getSandbox` does to reach one — the rest of it is preview URLs,
// sessions and the code interpreter, none of which anything here asks for.
let stub = (ns: Sandboxes, space: Space) => ns.get(ns.idFromName(named(space)))

/** What a grant is made and unmade with: the secret it is sealed under and
 * the ledger it is written in (grants.ts). */
type Keys = { SESSION_SECRET?: string; OAUTH_KV?: unknown }

// Whether a grant has enough life left to hand to a command. One command may
// run for {@link TIMEOUT}, so a grant with less than that left is one that
// would die under the command holding it — mint a fresh one instead.
let alive = (g: Grant | null, now: number): g is Grant =>
  !!g && g.exp * 1000 - now > TIMEOUT

/**
 * The container's environment: the platform to talk to, and the grant that is
 * the caller. `yaks` reads both by name and so does a `curl` written by hand,
 * so a command in the sandbox reaches the same tools the person's own agent
 * has — as the person, narrowed to this space, and no longer than the
 * container lives ({@link LIFE}).
 *
 * ONE GRANT PER CONTAINER, not one per command: the ledger row (grants.ts
 * `wear`) is what makes the second wake say the same grant as the first, since
 * the token itself is kept nowhere and re-derived from what the ledger holds.
 * A grant revoked by hand (tools.ts `grant`) is gone from the ledger, so the
 * next wake mints rather than saying a dead one again.
 *
 * Nothing to sign with — no secret, no KV, which is every probe and every
 * test — is an EMPTY environment rather than a refusal: the workbench still
 * compiles, and `yaks` inside it says it is not signed in.
 */
export let signed = async (
  env: Keys,
  space: Space,
  person: string,
  now = Date.now(),
): Promise<Record<string, string>> => {
  let book = ledger(env.OAUTH_KV)
  let secret = env.SESSION_SECRET
  if (!book || !secret) return {}
  let holder = named(space)
  let was = await book.wearing(holder)
  // Only this caller's own: a container woken by somebody else earlier is
  // still one container, and the person running commands in it now is who its
  // commands must speak as.
  let has = was?.person == person ? await book.held(was.person, was.id) : null
  if (alive(has, now)) {
    return { YAKS_TOKEN: await tokenOf(has, secret), YAKS_HOST: HOST }
  }
  let { grant, token } = await mint(secret, book, {
    person,
    space: space.slug,
    hours: LIFE,
  }, now)
  await book.wear(holder, grant, now)
  return { YAKS_TOKEN: token, YAKS_HOST: HOST }
}

// The grant the container was wearing, taken back. Telemetry rather than a
// failure, like the destroy it rides with: the grant dies of old age anyway,
// and a container nobody could revoke for is not a reason to fail the caller
// who was closing their space.
let bared = async (env: Keys, space: Space) => {
  try {
    let book = ledger(env.OAUTH_KV)
    if (!book) return
    let holder = named(space)
    let was = await book.wearing(holder)
    if (!was) return
    await book.drop(was.person, was.id)
    await book.bare(holder)
  } catch (e) {
    console.error('yak: sandbox grant would not go', space.slug, e)
  }
}

/**
 * The build session's sandbox, woken and signed in as the caller. The first
 * call starts the clock; every call after it rides the same container.
 *
 * ```ts
 * let box = boxOf(env, space, person, spend)
 * await box.exec('cargo build --release --target wasm32-unknown-unknown')
 * ```
 */
export let boxOf = (
  env: { SANDBOX?: Sandboxes } & Keys,
  space: Space,
  person: string,
  spend: Spend,
  now = Date.now,
): Box => {
  if (!env.SANDBOX) throw new Error(NO_BOX)
  let spent = seconds(spend, now())
  if (spent >= BUDGET) throw new Error(overBudget(spent))
  let first = spend.since == null
  spend.since ??= now()
  let box = stub(env.SANDBOX, space)
  // The idle timeout, set once a build rather than once a call — the SDK's
  // own `applySandboxConfiguration` is cached per namespace for the same
  // reason. It is a hop we do not wait for: a container that did not hear it
  // sleeps on the SDK's own default instead, which is longer, not forever.
  if (first) {
    Promise.resolve(box.setSleepAfter?.(SLEEP)).catch((e) =>
      console.error('yak: sandbox would not take a sleep', space.slug, e)
    )
  }
  // Named rather than spread: the stub is a Durable Object proxy, and what a
  // proxy answers is its methods, never its own properties.
  return {
    // The grant rides HERE — the SDK's per-invocation env, awaited by the
    // first command and handed to every one after it — rather than
    // `setEnvVars`, which reaches the container by exporting the token into a
    // shell where an `echo` would put it in the transcript.
    exec: async (cmd, opts) =>
      await box.exec(cmd, {
        ...opts,
        env: {
          ...await (spend.signing ??= signed(env, space, person)),
          ...opts?.env,
        },
      }),
    writeFile: (path, content, opts) => box.writeFile(path, content, opts),
    readFile: (path, opts) => box.readFile(path, opts),
    destroy: () => box.destroy(),
    setSleepAfter: (after) => box.setSleepAfter?.(after),
  }
}

/**
 * This space's container, destroyed. Answers whether there was a binding to
 * destroy one through at all.
 *
 * A container that would not die is telemetry, never a failed caller: it
 * sleeps on its own ({@link SLEEP}) and stops billing there. Both callers want
 * that — a build that has ended ({@link released}) and a space that is being
 * closed (erase.ts, T-34371), where the half-built tree inside it is part of
 * what `/privacy` says goes with the space.
 */
export let destroyed = async (
  env: { SANDBOX?: Sandboxes } & Keys,
  space: Space,
) => {
  if (!env.SANDBOX) return false
  try {
    await stub(env.SANDBOX, space).destroy()
  } catch (e) {
    console.error('yak: sandbox would not go', space.slug, e)
  }
  // And the grant it was wearing goes with it: a token that outlived its
  // container is a bearer nobody is holding. It is read off the ledger rather
  // than passed in, so erasing a space (erase.ts) revokes the grant a build
  // minted in some other request just as a build's own end does.
  await bared(env, space)
  return true
}

/**
 * What has been spent so far, counted and the clock started over. The count
 * is meter.ts's `countedSandbox`, passed in rather than imported: this file is
 * about the container and that one is about the bill.
 */
export let paid = async (
  spend: Spend,
  count: (seconds: number) => Promise<unknown>,
  now = Date.now,
) => {
  let spent = seconds(spend, now())
  if (!spent) return 0
  spend.since = null
  await count(spent)
  return spent
}

/**
 * The build is over: the container goes, and the seconds it held come back
 * for the caller to count. A build that never woke one destroys nothing and
 * answers 0.
 *
 * It does NOT write the meter itself, where {@link paid} does, because the
 * build counts its seconds in the same write as its build (builder.ts `end`,
 * meter.ts `countedBuild`) — two writes derived from one reading of the space
 * would each put the other's columns back.
 */
export let released = async (
  env: { SANDBOX?: Sandboxes },
  space: Space,
  spend: Spend,
  now = Date.now,
) => {
  let spent = seconds(spend, now())
  // The seconds are counted whether or not it went; a build that never woke
  // one has nothing to destroy.
  if (spend.since != null) await destroyed(env, space)
  spend.since = null
  return spent
}
