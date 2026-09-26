// The builder's loop (T-34239): a model, this platform's own tools, and one
// person — the agent that makes somebody their first app without them having
// to bring an agent of their own.
//
// It is the same door the connector is. The tools here are `TOOLS` (tools.ts)
// worn as `sugared` wears them for MCP (agent.ts), so `app_new` called from
// this loop runs the one function `app_new` has ever been — the space guard,
// the ceilings, the unseen block on the answer, all of it — and there is no
// second implementation to drift. What the loop adds is the shape a model
// wants: the table's own JSON Schema as a function tool, and the tool's
// sentence back as the result.
//
// Two providers, one seam. A `Model` answers one turn: what it said, which
// tools it wants, what it spent. Workers AI needs no key — the `AI` binding is
// the authorization — and is spoken by @yaks/workers-ai, which the loop's
// lines are handed to as @yaks/model items. OpenAI through the AI Gateway is
// the other: its Responses API takes `input` items and answers
// `function_call` items, shaped from {@link Line} here. The id says which: a
// Workers AI model is always `@cf/…`.
//
// Both tiers run on the binding today. Owner, 2026-09-05: "can't we use
// workers AI instead of AI Gateway to start now without purchasing anything?
// we already have free usage" — so the free build is GLM Flash and the paid
// one is the full GLM, both on `AI`, and nothing has to be bought or made
// before a person can build. The OpenAI path stays here whole, behind config
// nobody has set: point BUILDER_MODEL_PAID at an id that is not `@cf/…` and
// name a gateway, and the paid build speaks to OpenAI instead.
//
// The loop has three ends: a round limit, an output ceiling per turn, and a
// wall budget. Every one of them, every refusal a provider makes, and the
// month's build ceiling comes back as a sentence in the conversation rather
// than a thrown error, because the person reading it is not a programmer and
// the page that will draw this (T-34240) draws lines.
//
// A build is an `app_deploy` the builder performed, not a message: the loop
// asks the meter before it spends anything (`over`) and counts one
// afterwards where a deploy went through (`countedBuild`), so a long
// conversation that ships one app costs one build and one that ships nothing
// costs none. What its model calls cost is counted either way
// (`countedSpend`), weighed in dollars by the model's price (models.ts), and
// the month's model allowance is asked before every round, since a
// conversation that never deploys spends it all the same. What the meter is holding is meter.ts's (T-34241); the page is
// somebody else's (T-34242).
import { type Item, ModelError, type Reply } from '@yaks/model'
import { worded } from '@yaks/tools'
import { workersAi } from '@yaks/workers-ai'
import { running } from './agent.ts'
import { directory, type Space } from './directory.ts'
import * as dirPart from './directory.ts'
import { bound, type Env } from './env.ts'
import { instructions, whole } from './guide.ts'
import { type Host, hosted, url } from './host.ts'
import { atCeiling, countedBuild, countedSpend, over, pooled } from './meter.ts'
import { type Price, priceOf, weigh } from './models.ts'
import { asset } from './preauth.ts'
import { asleep, released, spending } from './sandbox.ts'
import type { Who } from './session.ts'
import { type Ctx, TOOLS } from './tools.ts'
import { standing } from './standing.ts'
import { caught } from './sentry.ts'

/** What one response used, in tokens; its model's price weighs it in dollars
 * (models.ts `weigh`). */
export type Usage = { input: number; output: number; cached: number }

/** One tool the model asked for, with its arguments still as the JSON text
 * the model wrote — parsed once, where it is called. */
export type Call = { id: string; name: string; args: string }

/**
 * One line of the conversation, in neither provider's format: what the
 * person said, what the builder said (and asked for), and what a tool
 * answered. A provider translates these into its own wire and back.
 */
export type Line =
  | { said: 'person'; text: string }
  | { said: 'builder'; text: string; calls?: Call[]; usage?: Usage }
  | { said: 'tool'; call: string; name: string; text: string }

/** A tool as a model is offered it: the table's own JSON Schema, verbatim. */
export type Fn = {
  name: string
  description: string
  parameters: {
    type: 'object'
    properties: Record<string, unknown>
    required?: string[]
  }
}

/** A tool, called: the sentence it answers, and the view's data beside it. */
type Run = ReturnType<typeof running>

/** One turn, asked of a model. */
export type Ask = {
  system: string
  said: Line[]
  fns: Fn[]
  /** the most this turn may write */
  tokens: number
}

/** What a model answered: its words, the tools it wants run, what it spent. */
export type Answer = { text: string; calls: Call[]; usage: Usage }

/** A model, whichever provider it is behind, and its price in the catalogue
 * (models.ts). One with no price is never asked: what it spent could not be
 * counted. */
export type Model = { id: string; price?: Price; ask(a: Ask): Promise<Answer> }

/**
 * The loop, as it happens. A round is not a stream — a turn arrives whole —
 * but the four things a person watching wants to see arrive at four different
 * moments, and a build takes a minute. So the loop tells whoever is listening
 * at each of them, and the object holding the socket turns each into a frame
 * (build.ts, T-34240). Nobody listening is the ordinary case: `on` is
 * optional and the loop's answer is the same either way.
 */
export type Beat =
  | { beat: 'said'; text: string }
  | { beat: 'tool'; call: string; name: string; args: string }
  | { beat: 'ran'; call: string; name: string; text: string; ok: boolean }
  | { beat: 'done'; text: string; refused?: string }

/** How far the loop may go before it says so. */
export type Opts = {
  /** who is watching this build happen, if anybody */
  on?: (b: Beat) => void
  /** the model to run, where the caller has one already (tests, a retry) */
  model?: Model
  /** the model id, overriding what the space's tier picks */
  id?: string
  /** at most this many model turns (default 12) */
  rounds?: number
  /** at most this many output tokens per turn (default 4096) */
  tokens?: number
  /** at most this long, wall clock, in ms (default 60000) */
  ms?: number
  /** the clock, so a test can move it (default `Date.now`) */
  now?: () => number
}

/** What a build came to. */
export type Built = {
  /** the last thing the builder said — the refusal, where it refused */
  text: string
  /** the conversation, whole, ready to be said again next turn */
  lines: Line[]
  /** every response summed */
  usage: Usage
  /** how many turns the model took */
  rounds: number
  /** why it stopped short, when it did */
  refused?: string
}

/** The free build's model: GLM on Workers AI, which needs no key of ours.
 * $0.15/M in, $0.50/M out, a million tokens of context, and it lists function
 * calling. It wants Workers Paid, which this account has;
 * `@cf/qwen/qwen3.8-27b` is the fallback where a plan has no frontier model. */
export let FREE = '@cf/zai-org/glm-5.3-flash'

/** The paid build's model: the same family, at full size — $1.40/M in,
 * $4.40/M out on the same binding, so a Plus space builds on a bigger model
 * and the platform still buys nothing. Terra (`gpt-5.6-terra`) is one
 * BUILDER_MODEL_PAID away, once there is a gateway to reach it through. */
export let PAID = '@cf/zai-org/glm-5.3'

/** Nobody is built for: the loop writes as the person calling it, and there
 * is no such person. */
export let anonymous = (env: Host = {}) =>
  'Sign in first — everything I would build belongs to somebody, and I ' +
  `write as whoever is asking. ${url(env, '/login')}`

export let ANON = anonymous()

/** A model that is not Workers AI's, with no way to reach it. Nobody meets
 * this by default — both tiers run on the binding — only a platform whose
 * BUILDER_MODEL_PAID names an OpenAI model with no gateway set. Named in a
 * sentence, because the person reading it did nothing wrong. */
export let NO_KEY =
  "That model is OpenAI's and this platform has no AI Gateway to reach it " +
  'through: set AI_GATEWAY, and either OPENAI_API_KEY or AI_GATEWAY_TOKEN ' +
  'to pay for it. Every build here runs on Workers AI unless ' +
  'BUILDER_MODEL_PAID says otherwise. Nothing was built.'

/** Every model of this one, everywhere, is busy: the account's per-model rate
 * (20 a minute on the frontier ones). It is a wait, not a failure. */
export let BUSY =
  'Every builder is busy for a moment — ask me again in a few seconds and I ' +
  'will pick this up where it is.'

// A rate limit, from either provider: @yaks/workers-ai reads the binding's
// own words for it, and the gateway answers 429.
let busy = (e: unknown) => e instanceof ModelError && e.code == 'busy'

/** No Workers AI binding — a local run, or a probe. Both tiers run on it, so
 * this is every build on a runtime that has none. */
export let NO_AI =
  'No model is bound here: a build runs on Workers AI through the AI binding ' +
  'and this runtime has none. Nothing was built.'

/** A model the catalogue has no price for, so nothing it spent could be
 * counted. Nobody meets this by default: both tiers' models are priced. */
export let unpriced = (id: string) =>
  `The model this platform builds with (${id}) has no price in its ` +
  'catalogue, so nothing it spent could be counted, and I will not run it. ' +
  'Nothing was built.'

let tooMany = (n: number) =>
  `I kept reaching for tools and stopped myself after ${n} rounds. What is ` +
  'built so far is built — say what you want next and I will pick it up.'

let tooLong = (ms: number) =>
  `I ran out of time after ${Math.round(ms / 1000)} seconds. What is built ` +
  'so far is built — ask me again and I will pick it up.'

// ---- the roster ------------------------------------------------------------

/**
 * The platform's verbs as function tools. The description and the schema come
 * off the table, where they are already JSON Schema — going through the Zod
 * the MCP SDK wants and back would lose what `propOf` cannot carry, an `enum`
 * among it — and the `run` is `running`, which is the very call the connector
 * makes (agent.ts).
 */
export let roster = (ctx: Ctx): { fn: Fn; run: Run }[] =>
  TOOLS.map((t) => ({
    fn: {
      name: t.name,
      description: hosted(t.description, ctx.env),
      parameters: JSON.parse(hosted(JSON.stringify(t.input), ctx.env)),
    },
    run: running(ctx, t),
  }))

// The words in an answer: a platform tool answers bundles, and its sentence
// is the prose one of them carries (@yaks/tools `worded`), so this is where
// the model's line comes from.
let words = worded

// One tool, run. A refusal is the tool's own sentence handed back to the
// model, exactly as MCP hands it one (`isError` with the text): a bad
// argument is something to correct on the next turn, not the end of the
// conversation.
let called = async (
  by: Map<string, Run>,
  c: Call,
): Promise<{ text: string; ok: boolean }> => {
  let run = by.get(c.name)
  if (!run) return { text: `no tool ${c.name}`, ok: false }
  try {
    let said = await run(c.args.trim() ? JSON.parse(c.args) : {})
    return { text: words(said), ok: true }
  } catch (e) {
    // The same line the connector draws (@yaks/tools `faulted`): a refusal
    // is the model's to correct, anything else is ours.
    caught(e, { tool: c.name, request: 'build' })
    return { text: e instanceof Error ? e.message : String(e), ok: false }
  }
}

/**
 * What the builder reads before it reads anything else: the connector's own
 * instructions, then the guide whole. One text, so what an agent is taught
 * here and what an agent is taught over MCP cannot drift.
 */
export let prompt = async (env: Env, ctx?: Ctx): Promise<string> => {
  // The apps this person already has, with the notes beside each and what
  // they have said here (standing.ts, T-34425). The builder is our own agent
  // and this is our own prompt, not a tool list a host classifies, so it takes
  // the passage whole where the connector puts the roster on its instructions
  // and hands the notes over at `about` (T-34632). It goes last: it is about
  // this person's apps, and the guide it follows is about apps in general.
  let apps = ctx ? (await standing(ctx)).notes : ''
  let after = apps ? `\n\n---\n\n${apps}` : ''
  try {
    let page = await asset(env, whole(env))
    if (!page.ok) {
      await page.body?.cancel()
      return instructions(env) + after
    }
    return `${instructions(env)}\n\n---\n\n${await page.text()}${after}`
  } catch (e) {
    caught(e, { request: 'build prompt' })
    return instructions(env) + after
  }
}

// ---- the providers ---------------------------------------------------------

let n = (v: unknown): number => typeof v == 'number' && v > 0 ? v : 0

// The loop's lines as @yaks/model items, and a reply back as the loop's
// answer: @yaks/workers-ai speaks Workers AI, and the loop still speaks `Line`.
// A builder turn that said nothing but its calls sends only the calls.
let items = (said: Line[]): Item[] =>
  said.flatMap((l): Item[] =>
    l.said == 'person'
      ? [{ kind: 'user', text: l.text }]
      : l.said == 'tool'
      ? [{ kind: 'result', id: l.call, output: l.text }]
      : [
        { kind: 'assistant', text: l.text },
        ...(l.calls ?? []).map((c): Item => ({ kind: 'call', ...c })),
      ]
  ).filter((i) => i.kind != 'assistant' || i.text)

let answer = (reply: Reply): Answer => ({
  text: reply.items.flatMap((i) => i.kind == 'assistant' ? [i.text] : [])
    .join('\n'),
  calls: reply.items.flatMap((i) =>
    i.kind == 'call' ? [{ id: i.id, name: i.name, args: i.args }] : []
  ),
  usage: {
    input: reply.usage?.input_tokens ?? 0,
    output: reply.usage?.output_tokens ?? 0,
    cached: reply.usage?.cached_tokens ?? 0,
  },
})

/**
 * The free build: a Workers AI model through the `AI` binding. No key, no
 * gateway, nothing to mint — the binding is the authorization.
 */
let binding = (env: Env, id: string): Model => ({
  id,
  price: priceOf(id),
  ask: async ({ system, said, fns, tokens }) => {
    if (!env.AI) throw new Error(NO_AI)
    let model = workersAi(env.AI)
    return answer(
      await model({
        model: id,
        instructions: system,
        items: items(said),
        tools: fns,
        tokens,
      }),
    )
  },
})

// Where OpenAI is reached: the gateway, so every call is logged, cached and
// rate-limited by the account rather than by us. `OPENAI_API` is the probe's
// door to somewhere else; the binding knows its own URL; and the URL can be
// built from the account tag and the gateway's name where it does not.
let gateway = async (env: Env): Promise<string | null> => {
  if (env.OPENAI_API) return env.OPENAI_API.replace(/\/+$/, '')
  let id = env.AI_GATEWAY
  if (!id) return null
  if (env.AI?.gateway) {
    let at = await env.AI.gateway(id).getUrl('openai')
    return at.replace(/\/+$/, '')
  }
  return env.CF_ACCOUNT
    ? `https://gateway.ai.cloudflare.com/v1/${env.CF_ACCOUNT}/${id}/openai`
    : null
}

/**
 * The paid build: OpenAI's Responses API through the AI Gateway. Either key
 * works and both may ride together — ours in `Authorization`, or the
 * gateway's own stored one behind `cf-aig-authorization`.
 */
export let openai = (env: Env, id: string): Model => ({
  id,
  price: priceOf(id),
  ask: async ({ system, said, fns, tokens }) => {
    let at = await gateway(env)
    let key = env.OPENAI_API_KEY
    let aig = env.AI_GATEWAY_TOKEN
    // The gateway is what must exist; the key is not. Cloudflare's Unified
    // Billing pays OpenAI out of the account's own credits, so a gateway with
    // no key of ours still answers.
    if (!at) throw new Error(NO_KEY)
    let input: Record<string, unknown>[] = []
    for (let l of said) {
      if (l.said == 'person') input.push({ role: 'user', content: l.text })
      else if (l.said == 'builder') {
        if (l.text) input.push({ role: 'assistant', content: l.text })
        for (let c of l.calls ?? []) {
          input.push({
            type: 'function_call',
            call_id: c.id,
            name: c.name,
            arguments: c.args,
          })
        }
      } else {
        input.push({
          type: 'function_call_output',
          call_id: l.call,
          output: l.text,
        })
      }
    }
    let res = await fetch(`${at}/responses`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(key ? { authorization: `Bearer ${key}` } : {}),
        ...(aig ? { 'cf-aig-authorization': `Bearer ${aig}` } : {}),
      },
      body: JSON.stringify({
        model: id,
        instructions: system,
        input,
        tools: fns.map((f) => ({ type: 'function', ...f })),
        max_output_tokens: tokens,
        store: false,
      }),
    })
    if (res.status == 429) throw new ModelError('busy', '429 from the model')
    if (!res.ok) throw new Error(`the model answered ${res.status}`)
    let body = await res.json() as {
      output?: {
        type?: string
        call_id?: string
        name?: string
        arguments?: string
        content?: { type?: string; text?: string }[]
      }[]
      usage?: {
        input_tokens?: unknown
        output_tokens?: unknown
        input_tokens_details?: { cached_tokens?: unknown }
      }
    }
    let out = body.output ?? []
    let u = body.usage ?? {}
    return {
      text: out
        .filter((i) => i.type == 'message')
        .flatMap((i) => i.content ?? [])
        .filter((c) => c.type == 'output_text')
        .map((c) => c.text ?? '')
        .join('\n'),
      calls: out.filter((i) => i.type == 'function_call').map((i) => ({
        id: i.call_id ?? '',
        name: i.name ?? '',
        args: i.arguments ?? '{}',
      })),
      usage: {
        input: n(u.input_tokens),
        output: n(u.output_tokens),
        cached: n(u.input_tokens_details?.cached_tokens),
      },
    }
  },
})

/** Which model this space builds on: its tier picks, config overrides. */
export let idOf = (env: Env, space: Space): string =>
  space.tier == 'plus'
    ? env.BUILDER_MODEL_PAID ?? PAID
    : env.BUILDER_MODEL_FREE ?? FREE

/** The provider an id names: a Workers AI model is always `@cf/…`. */
export let modelOf = (env: Env, id: string): Model =>
  id.startsWith('@cf/') ? binding(env, id) : openai(env, id)

/**
 * A scripted model, for the stand-in: it answers the turns it was given, in
 * order, and keeps what it was asked so a test can read the tool list and the
 * conversation the loop built. Past the end of the script it says nothing,
 * which ends the loop.
 */
export let fake = (script: Partial<Answer>[]) => {
  let asked: Ask[] = []
  let at = 0
  return {
    id: 'fake',
    price: priceOf(FREE),
    asked,
    ask: (a: Ask) => {
      asked.push(a)
      let one = script[at++] ?? {}
      return Promise.resolve({
        text: one.text ?? '',
        calls: one.calls ?? [],
        usage: one.usage ?? { input: 0, output: 0, cached: 0 },
      })
    },
  }
}

/**
 * Build. The person says something, the model answers, its tools run as that
 * person, and it answers again — until it stops asking for tools or one of
 * the three limits stops it.
 *
 * ```ts ignore
 * let out = await build(env, who, space, [{ said: 'person', text: 'a recipe box' }])
 * ```
 */
export let build = async (
  env: Env,
  who: Who,
  space: Space,
  said: Line[],
  opts: Opts = {},
): Promise<Built> => {
  let lines = [...said]
  let usage: Usage = { input: 0, output: 0, cached: 0 }
  let rounds = 0
  let built = false
  // What the model this build runs on costs, once one is picked; and what the
  // conversation has spent on it so far, in dollars.
  let price: Price | undefined
  let cost = () =>
    price
      ? weigh(price, {
        input_tokens: usage.input,
        output_tokens: usage.output,
        cached_tokens: usage.cached,
      })
      : 0
  // A listener's own failure is not the build's: a socket that went away
  // mid-round must not end a conversation that is still going.
  let on = (b: Beat) => {
    try {
      opts.on?.(b)
    } catch (e) {
      caught(e, { request: 'build', space: space.slug })
    }
  }
  // The workbench this build may reach for (sandbox.ts, T-34264). It is minted
  // whether or not anything wants a container: the sandbox tools read it off
  // the `Ctx` to know they are inside a build, and one that never woke a
  // container costs nothing and destroys nothing.
  let spend = spending()
  // Every way out of the loop, including the refusals: a build that happened
  // is counted whichever end the conversation came to, and a conversation
  // that deployed nothing is counted as the model dollars and seconds it
  // spent and no build (meter.ts `countedSpend`). The container goes on every one of
  // those ends too — a refusal is not a reason to leave one running.
  let end = async (refused?: string): Promise<Built> => {
    if (refused) lines.push({ said: 'builder', text: refused })
    let seconds = await released(env, space, spend)
    // The container went with the build, so the person's place goes too
    // (sandbox.ts `awake`), rather than when its nap would have ended.
    if (seconds && who.person) await asleep(env, space, who.person)
    // One write, from one reading of the space: the build, what its model
    // cost and the seconds it compiled for go together.
    if (built) await countedBuild(env, space, cost(), seconds)
    else await countedSpend(env, space, cost(), seconds)
    let last = [...lines].reverse().find((l) => l.said == 'builder')
    let text = last?.said == 'builder' ? last.text : ''
    on({ beat: 'done', text, ...(refused ? { refused } : {}) })
    return {
      text,
      lines,
      usage,
      rounds,
      ...(refused ? { refused } : {}),
    }
  }
  if (!who.person) return await end(anonymous(env))
  // Fresh, every read: a tool answers about what a tool just wrote
  // (directory.ts, mcp.ts).
  let dir = directory(bound(env.DIRECTORY, dirPart.fetch, env), true)
  // The month's builds and model allowance, the account's on a free space
  // (meter.ts, T-34241, T-37882). They are asked before anything is spent,
  // and what comes back is a sentence the builder says rather than a door
  // slammed mid-conversation — so a refused build costs the person nothing,
  // not a build and not the model call of the refusal. The reading is taken
  // once; what this conversation spends is added to it round by round.
  let month = await pooled(dir, space)
  let full = (['builds', 'models'] as const).find((w) => over(space, month, w))
  if (full) return await end(atCeiling(space, full, env))

  let ctx: Ctx = { env, dir, person: who.person, spend }
  let model = opts.model ?? modelOf(env, opts.id ?? idOf(env, space))
  price = model.price
  if (!price) return await end(unpriced(model.id))
  let tools = roster(ctx)
  let by = new Map(tools.map((t) => [t.fn.name, t.run]))
  let fns = tools.map((t) => t.fn)
  let system = await prompt(env, ctx)
  let max = opts.rounds ?? 12
  let tokens = opts.tokens ?? 4096
  let ms = opts.ms ?? 60_000
  let now = opts.now ?? Date.now
  let started = now()

  while (true) {
    if (rounds >= max) return await end(tooMany(max))
    if (over(space, month, 'models', cost())) {
      return await end(atCeiling(space, 'models', env))
    }
    if (now() - started > ms) return await end(tooLong(ms))
    let answer: Answer
    try {
      answer = await model.ask({ system, said: lines, fns, tokens })
    } catch (e) {
      if (!busy(e)) caught(e, { request: 'build model', space: space.slug })
      return await end(
        busy(e) ? BUSY : e instanceof Error ? e.message : String(e),
      )
    }
    rounds++
    usage.input += answer.usage.input
    usage.output += answer.usage.output
    usage.cached += answer.usage.cached
    lines.push({
      said: 'builder',
      text: answer.text,
      ...(answer.calls.length ? { calls: answer.calls } : {}),
      usage: answer.usage,
    })
    if (answer.text) on({ beat: 'said', text: answer.text })
    if (!answer.calls.length) return await end()
    for (let c of answer.calls) {
      on({ beat: 'tool', call: c.id, name: c.name, args: c.args })
      let said = await called(by, c)
      on({
        beat: 'ran',
        call: c.id,
        name: c.name,
        text: said.text,
        ok: said.ok,
      })
      // What makes this conversation a build: an app_deploy that went
      // through. A conversation that ships one app costs one build however
      // many turns it took, and one that ships nothing costs none.
      if (c.name == 'app_deploy' && said.ok) built = true
      lines.push({ said: 'tool', call: c.id, name: c.name, text: said.text })
    }
  }
}
