// The sandbox, called the workbench in code (T-34264): a person's private
// container in a space, where an agent runs commands and keeps files while it
// works: a script over an attachment, an API call, a compile whose artifact is
// shipped into an app as ordinary files. It is the sandbox workspace this host lends
// file-and-command tools through @yaks/sandbox/cloudflare; computers and sandbox
// provisioning are separate from that Workspace interface.
//
// Owner, 2026-09-05: "and can we also give the agent some sandbox tools so
// they could compile rust, etc. if they needed to?"
//
// One sandbox per person per space (T-37893), so a person's Operator and
// the same person's own agent over the connector reach one workbench rather
// than two. It is a Cloudflare Container behind a Durable
// Object (`@cloudflare/sandbox`), which the deploy provisions from
// the stable sandbox/base/Dockerfile image: Cloudflare's own sandbox image plus pinned
// Rust, Python, Go and Zig toolchains — `zig cc` is the C and C++ path to
// wasm — and `wasm-bindgen` and `wasm-opt` beside them. Nothing rarer than
// those, because an image is disk, disk is money, and every megabyte of it is
// pulled before the first command runs; a build that wants something else
// installs it for the session with apt or a registry, and the container it
// installed into keeps it until it sleeps, after retaining its changed files.
//
// The binding is typed, never imported, the way every other binding in this
// kernel is (env.ts). @cloudflare/sandbox is a Worker package: it imports
// `cloudflare:workers`, which Deno cannot load, so a value import here would
// take every test that reaches a tool down with it. The one place its name
// appears as a value is yak-sandbox's entry (sandbox/index.ts), the Worker
// that holds the Durable Object class and its container, where no test looks. What that costs is the two lines of
// `getSandbox` we actually use — the object per name and the idle timeout —
// written out below beside the SDK function each mirrors.
//
// What it costs, and who says so. A container bills for the wall time it is
// awake, so the seconds counted here are the seconds from the first sandbox
// call in a build to the moment the build lets it go ({@link Spend}) — the
// figure Cloudflare bills on, not a sum of command durations. Past
// {@link BUDGET} the tools refuse in a sentence, the way every other ceiling
// on this platform refuses (@yaks/platform/standing): the person reading it
// asked for an app, not for a stack trace. The month's seconds land on
// `meter.seconds` (meter.ts `countedSpend`) — its own property beside `models`,
// because a model call and a container-second are billed separately and one
// number made of both is a number nobody can add up.
//
// What keeps it from running forever: @yaks/sandbox/cloudflare `SLEEP`. The
// container sleeps on its own after that long idle, which is where the
// billing stops. Shutdown retains changed files in R2; the next call restores
// them.
// Processes end at shutdown. Snapshots have no expiry or automatic purge.
//
// Its network is the whole internet. It is the person's box: whatever runs in
// it runs because they or their agent asked, and an agent a prompt has turned
// already acts as them, sandbox or not. So a list of hosts it may reach
// protected nothing, and stopped it cloning from GitHub. Only HTTP to this
// platform and its spaces' addresses passes through the kernel on its way out
// (sandbox/index.ts, index.ts `SandboxOutbound`); the rest leaves the container
// directly.
//
// It is signed in as the caller (T-34387) without holding the caller's token.
// Every command runs with `YAKS_HOST` and `YAKS_TOKEN` in its environment, and
// `YAKS_TOKEN` is a placeholder: a sentinel (@yaks/secrets) made for this one
// container ({@link placeholder}). On its way to this platform, or to its
// space's Git door, the kernel puts the token of the grant the container
// wears (grants.ts) in its Authorization header ({@link swapped}), as an app's calls out get
// a connection's key (outbound.ts, @yaks/egress); sent anywhere else it stays
// a placeholder. So the `yak` CLI
// the live platform supplies, and plain `curl`, reach the platform's own door
// as the person whose build this is, narrowed to this space. One grant per
// container rather than one per command ({@link signed}), and it dies with the
// container ({@link destroyed}). The placeholder rides the SDK's per-invocation
// env and is never exported into a shell.
import { type Line } from '@yaks/query'
import {
  type Box,
  cloudflareProvider,
  hold,
  type Lending,
  lending,
  named,
  NAP,
  POOL_BUSY,
  type Sandboxes,
  TIMEOUT,
} from '@yaks/sandbox/cloudflare'
import { granted, Refused } from '@yaks/egress'
import { DOORS } from '@yaks/git/door'
import { sentinel } from '@yaks/secrets'
import { directory, type Space, stamp } from './directory.ts'
import * as dirPart from './directory.ts'
import { bound, type Env } from './env.ts'
import type { Tier } from '@yaks/platform/plans'
import { evicted, jittered, retried } from '@yaks/durable-object/resets'
import type { Namespace } from '@yaks/durable-object/door'
import type { Clock } from '@yaks/fp'
import { type Grant, ledger, mint, tokenOf } from './grants.ts'
import { apex, type Host, spaceHost, url } from '@yaks/platform/host'
import { refuse } from './tool.ts'
import { plans } from '@yaks/platform/standing'
import { caught } from './defects.ts'
import { elapsed } from './lib/hops.ts'
import { type Meta, meta } from './meta.ts'

/**
 * The container time one build has spent, and when it started spending it.
 * `since` is null until the first sandbox call: a build that never reaches
 * for the workbench costs nothing and counts nothing.
 *
 * It is a mutable object on purpose: the tools that spend it are rows in the
 * platform table (tools.ts), and the call that pays for it (tools.ts `bench`)
 * reads what they spent.
 */
export type Spend = {
  since: number | null
  // The grant this build's commands run under, asked for once and awaited by
  // every command after ({@link signed}). It sits here rather than in a
  // closure because it belongs to the build, exactly as the seconds do.
  signing?: Promise<Record<string, string>>
  preparing?: Promise<void>
  person?: string
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

/** Where the `yaks` CLI and `curl` inside the container aim: this platform as
 * a whole origin, since what a script pastes into curl is `$YAKS_HOST/mcp`. */
export let sandboxHost = (env: Host = {}) => url(env)
export let HOST = sandboxHost()

/** A container by its Durable Object's id: what its calls out are said to
 * come from (sandbox/index.ts), and so what the ledger knows it by. */
export let idOf = (sandboxes: Sandboxes, name: string) =>
  String(sandboxes.idFromName(name))

// The secret's bytes, one array per secret: @yaks/secrets keeps the HMAC key
// it imports under the salt array it is handed (sentinel.ts `signing`), so
// fresh bytes each call would import the key again for every placeholder.
let salts = new Map<string, Uint8Array>()
let salt = (secret: string) => {
  let held = salts.get(secret)
  if (!held) salts.set(secret, held = new TextEncoder().encode(secret))
  return held
}

/** What a container holds in place of its grant's token: a sentinel of its id
 * under the platform's secret. It names the container rather than the grant,
 * so a process started under one grant still calls in after the next is
 * minted, and only the container it was made for can have it swapped. */
export let placeholder = (secret: string, container: string) =>
  sentinel(salt(secret), `sandbox:${container}`)

/** How long the grant in the container's environment lives, in hours: the
 * whole build budget plus the nap that outlasts it, so the token is alive for
 * as long as anything in the container could still be running and dead soon
 * after. Well under the day grants.ts allows at most. */
export let LIFE = (BUDGET + NAP) / 3600

/** No container bound here — the workerd probes and a test run, where the
 * binding does not exist. Said as a sentence, because a model reads it. */
export let NO_BOX =
  'No sandbox is running here: the sandbox is a Cloudflare Container and ' +
  'this runtime has none. Work through the other tools, and write an app ' +
  'in files a browser runs — html, css and js — so nothing needs compiling.'

/** How many sandboxes one space may hold awake at once, by its plan
 * (D-131886). A sandbox is keyed per person and space (`named`), so each
 * member working in a space wakes one of the space's. */
export let AWAKE: Record<Tier, number> = { free: 1, plus: 2, pro: 3 }

// Who is awake in each space is the directory's: a `lent` row per person and
// space (@yaks/sandbox/cloudflare `hold`), written by the platform, never by a
// person. No directory bound (a probe, a test of the container alone) holds
// nothing.
let lendingOf = (
  env: { STORE?: unknown; META?: Meta },
): Lending | undefined => {
  if (!env.STORE && !env.META) return
  let bound = env as { STORE: Namespace; META?: Meta }
  return {
    read: (line) => meta(bound).query(line as Line),
    apply: (bundles) => stamp(bound, { entities: bundles }),
  }
}

/** Past the space's limit. Said as the way out: wait, or the Plus plan. */
export let tooAwake = (space: Space, awake: number, env: Host = {}) =>
  `${space.slug} already has ${awake} sandbox${
    awake == 1 ? '' : 'es'
  } awake for other members, and the ${
    space.tier == 'pro'
      ? 'Pro plan'
      : space.tier == 'plus'
      ? 'Plus plan'
      : 'free tier'
  } allows ${AWAKE[space.tier ?? 'free']} at a time — wait: a sandbox ` +
  `sleeps after a minute of inactivity. ${plans(space, env)}`

/**
 * This person's sandbox in this space, counted awake — refused where other
 * members already hold as many in this space as its plan allows.
 */
export let awake = async (
  env: Bound,
  space: Space,
  person: string,
  now = Date.now(),
) => {
  let store = lendingOf(env)
  if (!env.WORKBENCH || !store) return
  let was = await hold(
    store,
    space.eid,
    person,
    AWAKE[space.tier ?? 'free'],
    now,
  )
  if (!was.held) throw refuse('limit', tooAwake(space, was.awake, env))
}

/** Past the budget. It says what is already built is built. */
export let overBudget = (spent: number) =>
  `I have had the workbench running for ${spent} seconds, and one build gets ` +
  `${BUDGET}. Whatever is already shipped into the app is shipped — ask me ` +
  'again and I will pick it up with a fresh one.'

/** What a grant is made and unmade with: the secret it is sealed under and
 * the ledger it is written in (grants.ts). */
type Keys = Host & {
  SESSION_SECRET?: string
  OAUTH_KV?: unknown
  DIRECTORY?: Env['DIRECTORY']
}

// The grants a container wears (grants.ts `ledger`), kept in the directory.
// Every caller is handed the Worker's whole env, which the directory's
// in-process door reads when no binding is wired.
let bookOf = (env: Keys) =>
  ledger(
    env.OAUTH_KV,
    directory(bound(env.DIRECTORY, dirPart.fetch, env as Env)),
  )
type Bound = Keys & {
  WORKBENCH?: Sandboxes
  STORE?: unknown
  META?: Meta
  CLOCK?: Clock
}

// A call into a box or its workspace, sent again while the runtime resets
// the object, each pause waited out on the env's clock.
let retrying = (env: Bound) => <T>(send: () => T | Promise<T>) =>
  elapsed(
    'workbench_wait',
    async () => {
      try {
        return await retried(send, true, evicted, jittered(env.CLOCK))
      } catch (error) {
        if (error instanceof Error && error.message == POOL_BUSY) {
          throw refuse('unavailable', POOL_BUSY)
        }
        throw error
      }
    },
  )

// Workbench owns persistence across idle shutdowns as well as disposal. Its
// prepare RPC restores a cold filesystem before any command reaches it.
let prepared = (_ref: unknown, box: Box) =>
  (box as Box & { prepare(): Promise<void> }).prepare()
let retained = async (_ref: unknown, box: Box) => {
  await box.destroy()
}

// Whether a grant has enough life left to hand to a command. One command may
// run for {@link TIMEOUT}, so a grant with less than that left is one that
// would die under the command holding it — mint a fresh one instead.
let alive = (g: Grant | null, now: number): g is Grant =>
  !!g && g.exp * 1000 - now > TIMEOUT

/**
 * The container's environment: the platform to talk to, and the placeholder
 * for the grant that is the caller. `yaks` reads both by name and so does a
 * `curl` written by hand, so a command in the sandbox reaches the same tools
 * the person's own agent has — as the person, narrowed to this space, and no
 * longer than the container lives ({@link LIFE}).
 *
 * One grant per container, not one per command: the ledger row (grants.ts
 * `wear`), under the container's id, is what the next wake reuses and what
 * {@link swapped} reads the token from, since the token itself is kept
 * nowhere and re-derived from what the ledger holds. A grant revoked by hand
 * (tools.ts `grant`) is gone from the ledger, so the next wake mints rather
 * than wearing a dead one.
 *
 * Nothing to sign with — no secret, no KV, which is every probe and every
 * test — is an empty environment rather than a refusal: the workbench still
 * compiles, and `yaks` inside it says it is not signed in.
 */
export let signed = async (
  env: Keys,
  container: string,
  space: Space,
  person: string,
  now = Date.now(),
): Promise<Record<string, string>> => {
  let book = bookOf(env)
  let secret = env.SESSION_SECRET
  if (!book || !secret) return {}
  let was = await book.wearing(container)
  // A personal container reuses only its person's still-valid grant.
  let has = was?.person == person ? await book.held(was.person, was.id) : null
  if (!alive(has, now)) {
    let { grant } = await mint(secret, book, {
      person,
      space,
      hours: LIFE,
    }, now)
    await book.wear(container, grant, now)
  }
  return {
    YAKS_TOKEN: await placeholder(secret, container),
    YAKS_HOST: sandboxHost(env),
  }
}

// What a container's placeholder stands for on one call: the token of the
// grant it wears, lent as @yaks/egress lends a credential, to this platform
// and the address of the one space the grant reaches, where a clone of its
// apps knocks (git_door.ts). None when it wears none.
export let lent = async (env: Keys, container: string) => {
  let book = bookOf(env)
  let secret = env.SESSION_SECRET
  let was = book && await book.wearing(container)
  let grant = was && await book!.held(was.person, was.id)
  if (!grant || !secret) return []
  return [{
    sentinel: await placeholder(secret, container),
    value: await tokenOf(grant, secret),
    hosts: [apex(env), ...grant.space ? [spaceHost(env, grant.space)] : []],
  }]
}

/** A container's platform sign-in: only the connector and its space's Git
 * door receive credentials, in Authorization alone. App Workers may echo
 * every byte they receive, so neither their requests nor arbitrary request
 * content can stand for the grant. */
export let swapped = async (
  env: Keys,
  container: string,
  req: Request,
  send: typeof fetch = fetch,
): Promise<Response> => routed(apex(env), await lent(env, container), req, send)

/** Authenticate a platform request without lending the token to app code or
 * replacing placeholders in caller-controlled content. Redirects return to
 * the container, whose next request is authorized independently. */
export let routed = async (
  platform: string,
  lend: Awaited<ReturnType<typeof lent>>,
  req: Request,
  send: typeof fetch = fetch,
): Promise<Response> => {
  let url = new URL(req.url)
  let trusted = url.hostname == platform
    ? url.pathname == '/mcp'
    : DOORS.test(url.pathname) &&
      lend.some((g) => g.hosts.includes(url.hostname))
  if (!trusted) return send(req)
  let auth = req.headers.get('authorization')
  if (!auth) return send(req)
  try {
    return await granted(
      lend,
      new Request(url.origin, { headers: { authorization: auth } }),
      (signed) => {
        let headers = new Headers(req.headers)
        headers.set(
          'authorization',
          new Request(signed).headers.get('authorization')!,
        )
        return send(new Request(req, { headers, redirect: 'manual' }))
      },
    )
  } catch (e) {
    if (!(e instanceof Refused)) throw e
    return new Response(`yaks.app refused this call: ${e.message}`, {
      status: 403,
    })
  }
}

// The grant the container was wearing, taken back. Telemetry rather than a
// failure, like the destroy it rides with: the grant dies of old age anyway,
// and a container nobody could revoke for is not a reason to fail the caller
// who was closing their space.
let bared = async (env: Keys, space: Space, holder: string) => {
  try {
    let book = bookOf(env)
    if (!book) return
    let was = await book.wearing(holder)
    if (!was) return
    await book.drop(was.person, was.id)
    await book.bare(holder)
  } catch (e) {
    caught(e, { request: 'sandbox grant', space: space.slug })
  }
}

// Deno reloads this tiny, dependency-free launcher from the live platform.
// It downloads the immutable CLI workspace only when its content changes.
export let LAUNCHER = `#!/bin/sh
exec deno run --quiet --no-config --reload --allow-net --allow-env --allow-read --allow-write --allow-run=deno "$YAKS_HOST/_cli/launch.ts" "$@"
`

/** The host lends its configured provider after checking the build's budget
 * and the space's count of sandboxes awake, holding this one awake in it.
 * Billing starts at first need; grants are supplied only to command invocations. */
export let workbench = async (
  env: Bound,
  space: Space,
  person: string,
  spend: Spend,
  now = Date.now,
) => {
  let ns = env.WORKBENCH
  if (!ns) throw new Error(NO_BOX)
  let spent = seconds(spend, now())
  if (spent >= BUDGET) throw refuse('limit', overBudget(spent))
  let first = spend.since == null
  if (spend.person != null && spend.person != person) {
    throw new Error('a sandbox build belongs to one person')
  }
  spend.person = person
  await awake(env, space, person, now())
  let ref = { id: named(space.eid, person) }
  let provider = cloudflareProvider(ns, {
    ephemeral: true,
    prepare: prepared,
    trash: retained,
    retry: retrying(env),
    env: () => spend.signing ??= signed(env, idOf(ns, ref.id), space, person),
    sleepError: (e) =>
      caught(e, { request: 'sandbox sleep', space: space.slug }),
  })
  let lent = await (first ? provider.request!(ref) : provider.connect(ref))
  await retrying(env)(() => prepared(ref, ns.get(ns.idFromName(ref.id))))
  spend.since ??= now()
  spend.preparing ??= (async () => {
    await lent.workspace.write('/usr/local/bin/yak', LAUNCHER)
    let result = await provider.exec(ref, 'chmod +x /usr/local/bin/yak')
    if (result.exitCode) throw new Error(`yak launcher: ${result.stderr}`)
    // The container owns the warm-up after this RPC returns. The launcher
    // coordinates concurrent yak calls; ordinary commands need not wait.
    try {
      await lent.workspace.start('yak --help >/dev/null')
    } catch (e) {
      caught(e, { request: 'sandbox warm', space: space.slug })
    }
  })().catch((error) => {
    spend.preparing = undefined
    throw error
  })
  await spend.preparing
  return { ...lent, provider, ref }
}

/**
 * This person's container in the space, destroyed. Answers whether there was a binding to
 * destroy one through at all.
 *
 * A container that would not die is telemetry, never a failed caller: it
 * sleeps on its own (@yaks/sandbox/cloudflare `SLEEP`) and stops billing there. Its caller
 * wants that: a space that is being closed (erase.ts, T-34371), where the
 * half-built tree inside it is part of what `/privacy` says goes with the
 * space.
 */
export let destroyed = async (
  env: Bound,
  space: Space,
  person: string,
) => {
  if (!env.WORKBENCH) return false
  try {
    await cloudflareProvider(env.WORKBENCH, {
      ephemeral: true,
      trash: retained,
      retry: retrying(env),
    }).dispose({ id: named(space.eid, person) })
  } catch (e) {
    caught(e, { request: 'sandbox destroy', space: space.slug })
  }
  // And the grant it was wearing goes with it: a token that outlived its
  // container is a bearer nobody is holding. It is read off the ledger rather
  // than passed in, so erasing a space (erase.ts) revokes the grant a call
  // minted in some other request.
  await bared(env, space, idOf(env.WORKBENCH, named(space.eid, person)))
  return true
}

/** Every member's container in the space, destroyed, those of members who
 * have since left included: every sandbox the space has lent. Its `lent`
 * rows go with the space's own row, which they die with. */
export let destroyedAll = async (env: Bound, space: Space) => {
  let store = lendingOf(env)
  if (!env.WORKBENCH || !store) return false
  for (let { to } of await lending(store, space.eid)) {
    await destroyed(env, space, to)
  }
  return true
}

/** A person's workbench and retained snapshots, purged after their space's
 * owner confirms permanent deletion through the shared confirmation page. */
export let purgedAll = async (env: Bound, space: Space) => {
  let store = lendingOf(env)
  let ns = env.WORKBENCH
  if (!ns || !store) return false
  for (let { to } of await lending(store, space.eid)) {
    let name = named(space.eid, to)
    await retrying(env)(() =>
      (ns.get(ns.idFromName(name)) as Box & { purge(): Promise<void> }).purge()
    )
    await bared(env, space, idOf(ns, name))
  }
  return true
}

/**
 * What has been spent so far, counted and the clock started over. The count
 * is meter.ts's `countedSandbox`, passed in rather than imported: both stay in the host, not in the provider.
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
