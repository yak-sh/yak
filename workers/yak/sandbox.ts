// The builder's workbench (T-34264): a container it can run commands in, so
// the things a browser cannot compile get compiled somewhere and the artifact
// is shipped into the app as ordinary files. It is the machine this host lends
// @yaks/harness's machine tools through @yaks/machine/cloudflare, as a box lends its
// own through @yaks/process.
//
// Owner, 2026-09-05: "and can we also give the agent some sandbox tools so
// they could compile rust, etc. if they needed to?"
//
// One sandbox per person per space (T-37893), so a person talking to
// the builder and the same person's own agent over the connector reach one
// workbench rather than two. It is a Cloudflare Container behind a Durable
// Object (`@cloudflare/sandbox`), which the deploy provisions from
// the stable sandbox/base/Dockerfile image: Cloudflare's own sandbox image plus pinned
// Rust, Python, Go and Zig toolchains — `zig cc` is the C and C++ path to
// wasm — and `wasm-bindgen` and `wasm-opt` beside them. Nothing rarer than
// those, because an image is disk, disk is money, and every megabyte of it is
// pulled before the first command runs; a build that wants something else
// installs it for the session with apt or a registry, and the container it
// installed into is destroyed at the end of that build (T-34516).
//
// The binding is typed, never imported, the way every other binding in this
// kernel is (env.ts). @cloudflare/sandbox is a Worker package: it imports
// `cloudflare:workers`, which Deno cannot load, so a value import here would
// take every test that reaches a tool down with it. The one place its name
// appears as a value is index.ts, where the deploy needs the Durable Object
// class and no test ever looks. What that costs is the two lines of
// `getSandbox` we actually use — the object per name and the idle timeout —
// written out below beside the SDK function each mirrors.
//
// What it costs, and who says so. A container bills for the wall time it is
// awake, so the seconds counted here are the seconds from the first sandbox
// call in a build to the moment the build lets it go ({@link Spend}) — the
// figure Cloudflare bills on, not a sum of command durations. Past
// {@link BUDGET} the tools refuse in a sentence, the way every other ceiling
// on this platform refuses (meter.ts): the person reading it asked for an app,
// not for a stack trace. The month's seconds land on `meter.seconds`
// (meter.ts `countedSpend`) — its own property beside `models`, because a
// model call and a container-second are billed separately and one number made
// of both is a number nobody can add up.
//
// What keeps it from running forever: the build destroys it when it ends, and
// {@link SLEEP} is the backstop for a build that never says so — the container
// sleeps on its own after that long idle, which is where the billing stops.
// Idle shutdown ends its processes and temporary files; ship artifacts before it sleeps.
//
// Its network is the whole internet. It is the person's box: whatever runs in
// it runs because they or their agent asked, and an agent a prompt has turned
// already acts as them, sandbox or not. So a list of hosts it may reach
// protected nothing, and stopped it cloning from GitHub. Only HTTP to this
// platform and its spaces' addresses passes through the kernel on its way out
// (index.ts `Sandbox`); the rest leaves the container directly.
//
// It is signed in as the caller (T-34387) without holding the caller's token.
// Every command runs with `YAKS_HOST` and `YAKS_TOKEN` in its environment, and
// `YAKS_TOKEN` is a placeholder: a sentinel (@yaks/secrets) made for this one
// container ({@link placeholder}). On its way to this platform, or to its
// space's own address, the kernel puts the token of the grant the container
// wears (grants.ts) in its place ({@link swapped}), as an app's calls out get
// a connection's key (outbound.ts, @yaks/egress); sent anywhere else it stays
// a placeholder. So the `yak` CLI
// the live platform supplies, and plain `curl`, reach the platform's own door
// as the person whose build this is, narrowed to this space. One grant per
// container rather than one per command ({@link signed}), and it dies with the
// container ({@link destroyed}). The placeholder rides the SDK's per-invocation
// env and is never exported into a shell.
import {
  cloudflareProvider,
  NAP,
  type Sandboxes,
  TIMEOUT,
} from '@yaks/machine/cloudflare'
export { CWD, NAP, SLEEP, TIMEOUT } from '@yaks/machine/cloudflare'
import { granted, Refused } from '@yaks/egress'
import { sentinel } from '@yaks/secrets'
import type { Space, Tier } from './directory.ts'
import { retried } from './door.ts'
import { type Grant, type Kv, ledger, mint, tokenOf } from './grants.ts'
import { apex, type Host, spaceHost, url } from './host.ts'
import { refuse } from './tool.ts'
import { caught } from './defects.ts'
import type { Workspaces } from './workspaces.ts'

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
  preparing?: Promise<void>
  person?: string
  legacy?: string[]
  copying?: Promise<string[]>
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

/** The most output one command hands back. A compiler that failed says why in
 * its first lines; the rest is the same warning again. */
export let CAP = 8_000

/** Where the `yaks` CLI and `curl` inside the container aim: this platform as
 * a whole origin, since what a script pastes into curl is `$YAKS_HOST/mcp`. */
export let sandboxHost = (env: Host = {}) => url(env)
export let HOST = sandboxHost()

/** A container by its Durable Object's id: what its calls out are said to
 * come from (index.ts `Sandbox`), and so what the ledger knows it by. */
export let idOf = (sandboxes: Sandboxes, name: string) =>
  String(sandboxes.idFromName(name))

/** What a container holds in place of its grant's token: a sentinel of its id
 * under the platform's secret. It names the container rather than the grant,
 * so a process started under one grant still calls in after the next is
 * minted, and only the container it was made for can have it swapped. */
export let placeholder = (secret: string, container: string) =>
  sentinel(new TextEncoder().encode(secret), `sandbox:${container}`)

/** How long the grant in the container's environment lives, in hours: the
 * whole build budget plus the nap that outlasts it, so the token is alive for
 * as long as anything in the container could still be running and dead soon
 * after. Well under the day grants.ts allows at most. */
export let LIFE = (BUDGET + NAP) / 3600

/** No container bound here — the workerd probes and a test run, where the
 * binding does not exist. Said as a sentence, because a model reads it. */
export let NO_BOX =
  'No sandbox is running here: the workbench is a Cloudflare Container and ' +
  'this runtime has none. Write the app in files a browser runs — html, css ' +
  'and js — and nothing needs compiling.'

/** How many sandboxes one person may hold awake at once, by the plan of the
 * space they are working in (T-37883). A sandbox is keyed per person and space, so
 * without this a person owning five spaces holds five containers, which is
 * every one the deploy runs (wrangler.toml `max_instances`). */
export let AWAKE: Record<Tier, number> = { free: 1, plus: 2 }

/** How long one call keeps a sandbox awake, in seconds: the longest command,
 * then the nap before it sleeps on its own. */
export let HELD = TIMEOUT / 1000 + NAP

// The sandboxes a person holds, in the KV the grants live in: one row per
// person, space eid → the unix second it is asleep by. One row rather than a
// row per sandbox because a count is one read of it, where a KV listing is
// neither consistent nor cheap. Nothing sweeps it: a sandbox past its second
// has slept, and the row dies a minute after the last of them.
let hold = (person: string) => `awake:${person}`

let held = async (kv: Kv, person: string, now: number) =>
  Object.fromEntries(
    Object.entries(
      JSON.parse(await kv.get(hold(person)) ?? '{}') as Record<string, number>,
    ).filter(([, until]) => until > now),
  )

/** Past the per-person limit. Said as the way out: finish, or wait. */
export let tooAwake = (awake: number, tier: Tier | null) =>
  `you already have ${awake} sandbox${
    awake == 1 ? '' : 'es'
  } awake in another space, and the ${
    tier == 'plus' ? 'Plus plan' : 'free tier'
  } allows ${AWAKE[tier ?? 'free']} at a time — finish there, or wait: a ` +
  `sandbox sleeps ${NAP / 60} minutes after its last command`

/**
 * This person's sandbox in this space, counted awake — refused where they
 * already hold as many elsewhere as the plan allows. No KV or no container
 * bound (a probe, a test) holds nothing.
 *
 * The row is written only when this space's second is half spent: KV takes
 * one write a second per key, and a build calls the tools faster than that.
 */
export let awake = async (
  env: { SANDBOX?: Sandboxes; OAUTH_KV?: unknown },
  space: Space,
  person: string,
  now = Date.now(),
) => {
  let kv = env.OAUTH_KV as Kv | undefined
  if (!env.SANDBOX || !kv?.get) return
  let t = Math.floor(now / 1000)
  let rows = await held(kv, person, t)
  let others = Object.keys(rows).filter((eid) => eid != space.eid).length
  if (others >= AWAKE[space.tier ?? 'free']) {
    throw refuse('limit', tooAwake(others, space.tier))
  }
  if ((rows[space.eid] ?? 0) - t > HELD / 2) return
  await kv.put(
    hold(person),
    JSON.stringify({ ...rows, [space.eid]: t + HELD }),
    {
      expirationTtl: HELD + 60,
    },
  )
}

/** This person's sandbox in this space, asleep: a build that destroyed its
 * container gives the place back at once rather than when the nap would. */
export let asleep = async (
  env: { OAUTH_KV?: unknown },
  space: Space,
  person: string,
  now = Date.now(),
) => {
  let kv = env.OAUTH_KV as Kv | undefined
  if (!kv?.get) return
  let rows = await held(kv, person, Math.floor(now / 1000))
  if (!(space.eid in rows)) return
  delete rows[space.eid]
  if (Object.keys(rows).length) {
    await kv.put(hold(person), JSON.stringify(rows), {
      expirationTtl: HELD + 60,
    })
  } else await kv.delete(hold(person))
}

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
export let named = (space: Space, person: string) =>
  `build-${space.eid}-${person}`

// The old shared box is the workspace source; WORKSPACES holds the durable
// census of clean personal copies. The source receives no new command environment. Keeping it
// reachable also lets a compile already running finish across the deploy.
export let shared = (space: Space) => `build-${space.eid}`

/** What a grant is made and unmade with: the secret it is sealed under and
 * the ledger it is written in (grants.ts). */
type Keys = Host & { SESSION_SECRET?: string; OAUTH_KV?: unknown }
type Bound = Keys & { SANDBOX?: Sandboxes; WORKSPACES?: Workspaces }

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
  let book = ledger(env.OAUTH_KV)
  let secret = env.SESSION_SECRET
  if (!book || !secret) return {}
  let was = await book.wearing(container)
  // A personal container reuses only its person's still-valid grant.
  let has = was?.person == person ? await book.held(was.person, was.id) : null
  if (!alive(has, now)) {
    let { grant } = await mint(secret, book, {
      person,
      space: space.slug,
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
let lent = async (env: Keys, container: string) => {
  let book = ledger(env.OAUTH_KV)
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

/**
 * A request a container sends, on its way out (index.ts `Sandbox`): to this
 * platform or its space's address, with the container's placeholder swapped
 * for its grant's token; anywhere else, another space's address included, as
 * it came, placeholder and all. Toward this platform, a placeholder the
 * container does not hold, one it holds no live grant for, or one sent over
 * plain http is refused with a 403, as an app's call out is (outbound.ts).
 */
export let swapped = async (
  env: Keys,
  container: string,
  req: Request,
  send: typeof fetch = fetch,
): Promise<Response> => {
  let to = new URL(req.url).hostname
  let lend = await lent(env, container)
  if (to != apex(env) && !lend.some((g) => g.hosts.includes(to))) {
    return send(req)
  }
  try {
    return await granted(lend, req, send)
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
    let book = ledger(env.OAUTH_KV)
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

/** The host lends its configured provider after checking the build's budget.
 * Billing starts at first need; grants are supplied only to command invocations. */
export let workbench = async (
  env: Bound,
  space: Space,
  person: string,
  spend: Spend,
  now = Date.now,
) => {
  let ns = env.SANDBOX
  if (!ns) throw new Error(NO_BOX)
  let spent = seconds(spend, now())
  if (spent >= BUDGET) throw refuse('limit', overBudget(spent))
  let first = spend.since == null
  if (spend.person != null && spend.person != person) {
    throw new Error('a sandbox build belongs to one person')
  }
  spend.person = person
  spend.since ??= now()
  let ref = { id: named(space, person) }
  let source = { id: shared(space) }
  let provider = cloudflareProvider(ns, {
    retry: retried,
    env: () => spend.signing ??= signed(env, idOf(ns, ref.id), space, person),
    sleepError: (e) =>
      caught(e, { request: 'sandbox sleep', space: space.slug }),
  })
  // Snapshot only the workspace into a clean container, never its processes,
  // system files or environment. The source records completed copies so a
  // retry or another command cannot overwrite the person's later work.
  let old = cloudflareProvider(ns, { retry: retried })
  if (!env.WORKSPACES) throw new Error('no sandbox workspace coordinator')
  let workspace = env.WORKSPACES.get(env.WORKSPACES.idFromName(source.id))
  spend.copying ??= retried(() => workspace.fork(source.id, ref.id)).then(
    async (processes) => {
      await bared(env, space, idOf(ns, source.id))
      return processes
    },
  ).catch((error) => {
    spend.copying = undefined
    throw error
  })
  spend.legacy = await spend.copying
  let lent = await (first ? provider.request!(ref) : provider.wake(ref))
  spend.preparing ??= (async () => {
    await lent.machine.write('/usr/local/bin/yak', LAUNCHER)
    let result = await provider.exec(ref, 'chmod +x /usr/local/bin/yak')
    if (result.exitCode) throw new Error(`yak launcher: ${result.stderr}`)
    // The container owns the warm-up after this RPC returns. The launcher
    // coordinates concurrent yak calls; ordinary commands need not wait.
    try {
      await lent.machine.start('yak --help >/dev/null')
    } catch (e) {
      caught(e, { request: 'sandbox warm', space: space.slug })
    }
  })()
  await spend.preparing
  if (!spend.legacy?.length) return { ...lent, provider, ref }
  let legacy = (await old.wake(source)).machine
  let processes = new Set(spend.legacy)
  let machine = lent.machine
  let of = (id: string) => processes.has(id) ? legacy : machine
  return {
    ...lent,
    machine: {
      ...machine,
      look: (id: string) => of(id).look(id),
      tail: (id: string, n: number) => of(id).tail(id, n),
      kill: (id: string, signal: 'SIGTERM' | 'SIGKILL') =>
        of(id).kill(id, signal),
    },
    provider,
    ref,
  }
}

/**
 * This person's container in the space, destroyed. Answers whether there was a binding to
 * destroy one through at all.
 *
 * A container that would not die is telemetry, never a failed caller: it
 * sleeps on its own ({@link SLEEP}) and stops billing there. Both callers want
 * that — a build that has ended ({@link released}) and a space that is being
 * closed (erase.ts, T-34371), where the half-built tree inside it is part of
 * what `/privacy` says goes with the space.
 */
export let destroyed = async (
  env: Bound,
  space: Space,
  person: string,
) => {
  if (!env.SANDBOX) return false
  try {
    await cloudflareProvider(env.SANDBOX, { retry: retried }).release({
      id: named(space, person),
    })
  } catch (e) {
    caught(e, { request: 'sandbox destroy', space: space.slug })
  }
  // And the grant it was wearing goes with it: a token that outlived its
  // container is a bearer nobody is holding. It is read off the ledger rather
  // than passed in, so erasing a space (erase.ts) revokes the grant a build
  // minted in some other request just as a build's own end does.
  await bared(env, space, idOf(env.SANDBOX, named(space, person)))
  return true
}

/** Erase every copy, including those of members who have since left. */
export let destroyedAll = async (
  env: Bound,
  space: Space,
) => {
  let ns = env.SANDBOX
  if (!ns) return false
  let provider = cloudflareProvider(ns, { retry: retried })
  let source = { id: shared(space) }
  if (!env.WORKSPACES) throw new Error('no sandbox workspace coordinator')
  let workspace = env.WORKSPACES.get(env.WORKSPACES.idFromName(source.id))
  let copies = await retried(() => workspace.retire())
  for (let ref of [...copies.map((id) => ({ id })), source]) {
    await provider.release(ref)
    await bared(env, space, idOf(ns, ref.id))
  }
  await retried(() => workspace.destroy())
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

/**
 * The build is over: the container goes, and the seconds it held come back
 * for the caller to count. A build that never woke one destroys nothing and
 * answers 0.
 *
 * It does not write the meter itself, where {@link paid} does, because the
 * build counts its seconds in the same write as its build (builder.ts `end`,
 * meter.ts `countedBuild`) — two writes derived from one reading of the space
 * would each put the other's properties back.
 */
export let released = async (
  env: Bound,
  space: Space,
  spend: Spend,
  now = Date.now,
) => {
  let spent = seconds(spend, now())
  // The seconds are counted whether or not it went; a build that never woke
  // one has nothing to destroy.
  if (spend.since != null && spend.person) {
    await destroyed(env, space, spend.person)
  }
  spend.since = null
  return spent
}
