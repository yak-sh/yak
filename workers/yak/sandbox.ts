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
// Dockerfile beside this file: Cloudflare's own sandbox image plus a pinned
// Rust toolchain, the `wasm32-unknown-unknown` target, `wasm-bindgen` and
// `wasm-opt`. Nothing else — an image is disk, disk is money, and every
// megabyte of it is pulled before the first command runs.
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
import type { Space } from './directory.ts'

/** One sandbox, as this file asks for it — the four things the tools do,
 * plus the one knob the deploy has no way to set. */
export type Box = {
  exec(
    cmd: string,
    opts?: { cwd?: string; timeout?: number },
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
export type Spend = { since: number | null }

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

/** How long an idle sandbox stays awake. The build normally destroys its own;
 * this is what catches the build that never got to say so. */
export let SLEEP = '5m'

/** The longest one command may run. Nothing here is interactive, and a
 * command that has not finished in four minutes is a command that is stuck. */
export let TIMEOUT = 240_000

/** Where a command runs unless it says otherwise — the sandbox's own
 * writable directory. */
export let CWD = '/workspace'

/** The most output one command hands back. A compiler that failed says why in
 * its first lines; the rest is the same warning again. */
export let CAP = 8_000

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

// The object holding this build session's container. The id is the space's
// EID rather than its slug: a slug is renamed and an eid is not, and a
// workbench that followed a rename to a fresh container would lose the
// half-built tree inside it.
//
// This is @cloudflare/containers `getContainer`, which is all `getSandbox`
// does to reach one — the rest of it is preview URLs, sessions and the code
// interpreter, none of which anything here asks for.
let stub = (ns: Sandboxes, space: Space) =>
  ns.get(ns.idFromName(`build-${space.eid}`))

/**
 * The build session's sandbox, woken. The first call starts the clock; every
 * call after it rides the same container.
 *
 * ```ts
 * let box = boxOf(env, space, spend)
 * await box.exec('cargo build --release --target wasm32-unknown-unknown')
 * ```
 */
export let boxOf = (
  env: { SANDBOX?: Sandboxes },
  space: Space,
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
  return box
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
  if (spend.since != null && env.SANDBOX) {
    try {
      await stub(env.SANDBOX, space).destroy()
    } catch (e) {
      // A container that would not die is telemetry, never a failed build: it
      // sleeps on its own ({@link SLEEP}) and the seconds are counted either
      // way.
      console.error('yak: sandbox would not go', space.slug, e)
    }
  }
  spend.since = null
  return spent
}
