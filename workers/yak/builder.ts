// The builder's loop (T-34239): a model, this platform's own tools, and one
// person — the agent that makes somebody their first app without them having
// to bring an agent of their own.
//
// IT IS THE SAME DOOR THE CONNECTOR IS. The tools here are `TOOLS` (tools.ts)
// worn as `sugared` wears them for MCP (agent.ts), so `app_new` called from
// this loop runs the one function `app_new` has ever been — the space guard,
// the ceilings, the unseen block on the answer, all of it — and there is no
// second implementation to drift. What the loop adds is the shape a model
// wants: the table's own JSON Schema as a function tool, and the tool's
// sentence back as the result.
//
// TWO PROVIDERS, ONE SEAM. A `Model` answers one turn: what it said, which
// tools it wants, what it spent. Workers AI needs no key — the `AI` binding is
// the authorization — and OpenAI through the AI Gateway is the other. Neither
// shape is pretended to be the other: Workers AI takes `messages` and answers
// a flat `tool_calls`, OpenAI's Responses API takes `input` items and answers
// `function_call` items, and each provider spells {@link Line} in its own
// words. The id says which: a Workers AI model is always `@cf/…`.
//
// BOTH TIERS RUN ON THE BINDING TODAY. Owner, 2026-09-05: "can't we use
// workers AI instead of AI Gateway to start now without purchasing anything?
// we already have free usage" — so the free build is GLM Flash and the paid
// one is the full GLM, both on `AI`, and nothing has to be bought or made
// before a person can build. The OpenAI path stays here whole, behind config
// nobody has set: point BUILDER_MODEL_PAID at an id that is not `@cf/…` and
// name a gateway, and the paid build speaks to OpenAI instead.
//
// The loop has three ends: a round limit, an output ceiling per turn, and a
// wall budget. Every one of them, every refusal a provider makes, and the
// month's build ceiling comes back as a SENTENCE in the conversation rather
// than a thrown error, because the person reading it is not a programmer and
// the page that will draw this (T-34240) draws lines.
//
// A BUILD is an `app_deploy` the builder performed, not a message: the loop
// asks the meter before it spends anything (`refusedBuild`) and counts one
// afterwards where a deploy went through (`countedBuild`), so a long
// conversation that ships one app costs one build and one that ships nothing
// costs none. What the meter is holding is meter.ts's (T-34241); the page is
// somebody else's (T-34242).
import { running } from './agent.ts'
import { directory, type Space } from './directory.ts'
import * as dirPart from './directory.ts'
import { bound, type Env } from './env.ts'
import { INSTRUCTIONS, WHOLE } from './guide.ts'
import { countedBuild, countedSandbox, refusedBuild } from './meter.ts'
import { asset } from './preauth.ts'
import { released, spending } from './sandbox.ts'
import type { Who } from './session.ts'
import { type Ctx, TOOLS } from './tools.ts'
import { standing } from './standing.ts'

/** What one response cost, in the words both providers can be read into.
 * `neurons` is Workers AI's own billing unit and rides only where it is
 * answered — the meter is read in tokens (meter.ts `Usage`). */
export type Usage = {
  input: number
  output: number
  cached: number
  neurons?: number
}

/** One tool the model asked for, with its arguments still as the JSON text
 * the model wrote — parsed once, where it is called. */
export type Call = { id: string; name: string; args: string }

/**
 * One line of the conversation, in neither provider's spelling: what the
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

/** A model, whichever provider it is behind. */
export type Model = { id: string; ask(a: Ask): Promise<Answer> }

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
export let ANON =
  'Sign in first — everything I would build belongs to somebody, and I ' +
  'write as whoever is asking. https://yaks.app/login'

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

// What a rate limit looks like from either provider: the binding throws with
// its own words and the gateway answers 429.
let busy = (e: unknown) =>
  /\b429\b|too many requests|rate.?limit|capacity/i.test(
    e instanceof Error ? e.message : String(e),
  )

/** No Workers AI binding — a local run, or a probe. Both tiers run on it, so
 * this is every build on a runtime that has none. */
export let NO_AI =
  'No model is bound here: a build runs on Workers AI through the AI binding ' +
  'and this runtime has none. Nothing was built.'

let tooMany = (n: number) =>
  `I kept reaching for tools and stopped myself after ${n} rounds. What is ` +
  'built so far is built — say what you want next and I will pick it up.'

let tooLong = (ms: number) =>
  `I ran out of time after ${Math.round(ms / 1000)} seconds. What is built ` +
  'so far is built — ask me again and I will pick it up.'

// ---- the roster ------------------------------------------------------------

/**
 * The platform's verbs as function tools. The description and the schema come
 * off the TABLE, where they are already JSON Schema — going through the Zod
 * the MCP SDK wants and back would lose what `propOf` cannot carry, an `enum`
 * among it — and the `run` is `running`, which is the very call the connector
 * makes (agent.ts).
 */
export let roster = (ctx: Ctx): { fn: Fn; run: Run }[] =>
  TOOLS.map((t) => ({
    fn: { name: t.name, description: t.description, parameters: t.input },
    run: running(ctx, t),
  }))

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
    return { text: said.text, ok: true }
  } catch (e) {
    return { text: e instanceof Error ? e.message : String(e), ok: false }
  }
}

/**
 * What the builder reads before it reads anything else: the connector's own
 * instructions, then the guide whole. One text, so what an agent is taught
 * here and what an agent is taught over MCP cannot drift.
 */
export let prompt = async (env: Env, ctx?: Ctx): Promise<string> => {
  // The apps this person already has, and the standing instructions beside
  // each (standing.ts, T-34425) — the same passage the connector puts on its
  // own instructions, so a rule written for one agent is not missed by the
  // other. It goes LAST: it is about this person's apps, and the guide it
  // follows is about apps in general.
  let apps = ctx ? (await standing(ctx)).text : ''
  let after = apps ? `\n\n---\n\n${apps}` : ''
  try {
    let page = await asset({ ASSETS: env.ASSETS }, WHOLE)
    if (!page.ok) {
      await page.body?.cancel()
      return INSTRUCTIONS + after
    }
    return `${INSTRUCTIONS}\n\n---\n\n${await page.text()}${after}`
  } catch {
    return INSTRUCTIONS + after
  }
}

// ---- the providers ---------------------------------------------------------

// The tool calls off a response, however the provider spelled them. Workers AI
// answers a flat `{name, arguments}` with no id of its own, and an
// OpenAI-compatible model answers `{id, function: {name, arguments}}` — both
// read here, and an id is minted where there is none, because the loop
// matches a result to its call by id.
let calls = (raw: unknown): Call[] =>
  (Array.isArray(raw) ? raw : []).map((one, i) => {
    let c = (one ?? {}) as {
      id?: unknown
      name?: unknown
      arguments?: unknown
      function?: { name?: unknown; arguments?: unknown }
    }
    let fn = c.function ?? c
    return {
      id: typeof c.id == 'string' && c.id ? c.id : `c${i + 1}`,
      name: String(fn.name ?? ''),
      args: typeof fn.arguments == 'string'
        ? fn.arguments
        : JSON.stringify(fn.arguments ?? {}),
    }
  })

let n = (v: unknown): number => typeof v == 'number' && v > 0 ? v : 0

/**
 * The free build: a Workers AI model through the `AI` binding. No key, no
 * gateway, nothing to mint — the binding is the authorization.
 */
export let workersAi = (env: Env, id: string): Model => ({
  id,
  ask: async ({ system, said, fns, tokens }) => {
    if (!env.AI) throw new Error(NO_AI)
    let messages: Record<string, unknown>[] = [
      { role: 'system', content: system },
    ]
    for (let l of said) {
      if (l.said == 'person') messages.push({ role: 'user', content: l.text })
      else if (l.said == 'builder') {
        messages.push({
          role: 'assistant',
          content: l.text,
          ...(l.calls?.length
            ? {
              tool_calls: l.calls.map((c) => ({
                id: c.id,
                name: c.name,
                arguments: c.args,
              })),
            }
            : {}),
        })
      } else {
        messages.push({
          role: 'tool',
          name: l.name,
          tool_call_id: l.call,
          content: l.text,
        })
      }
    }
    let out = await env.AI.run(id, {
      messages,
      tools: fns.map((f) => ({ type: 'function', function: f })),
      max_tokens: tokens,
    }) as {
      response?: unknown
      tool_calls?: unknown
      usage?: Record<string, unknown>
      choices?: { message?: { content?: unknown; tool_calls?: unknown } }[]
    }
    // Some models in the catalog answer the binding's own shape and some
    // answer OpenAI's; both are read, so a change of model is a change of id.
    let said0 = out.choices?.[0]?.message
    let u = out.usage ?? {}
    return {
      text: String(out.response ?? said0?.content ?? ''),
      calls: calls(out.tool_calls ?? said0?.tool_calls),
      usage: {
        input: n(u.prompt_tokens),
        output: n(u.completion_tokens),
        cached: n(u.cached_tokens),
        ...(n(u.neurons) ? { neurons: n(u.neurons) } : {}),
      },
    }
  },
})

// Where OpenAI is reached: the gateway, so every call is logged, cached and
// rate-limited by the account rather than by us. `OPENAI_API` is the probe's
// door to somewhere else; the binding knows its own URL; and the URL can be
// spelled from the account tag and the gateway's name where it does not.
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
    if (res.status == 429) throw new Error('429 from the model')
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
      calls: calls(
        out.filter((i) => i.type == 'function_call').map((i) => ({
          id: i.call_id,
          name: i.name,
          arguments: i.arguments,
        })),
      ),
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
  id.startsWith('@cf/') ? workersAi(env, id) : openai(env, id)

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
 * ```ts
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
  // A listener's own failure is not the build's: a socket that went away
  // mid-round must not end a conversation that is still going.
  let on = (b: Beat) => {
    try {
      opts.on?.(b)
    } catch (e) {
      console.warn('builder: a listener threw', e)
    }
  }
  // The workbench this build may reach for (sandbox.ts, T-34264). It is minted
  // whether or not anything wants a container: the sandbox tools read it off
  // the `Ctx` to know they are inside a build, and one that never woke a
  // container costs nothing and destroys nothing.
  let spend = spending()
  // Every way out of the loop, including the refusals: a build that HAPPENED
  // is counted whichever end the conversation came to, and a conversation
  // that deployed nothing is counted nowhere (meter.ts `countedBuild`). The
  // container goes on every one of those ends too — a refusal is not a reason
  // to leave one running.
  let end = async (refused?: string): Promise<Built> => {
    if (refused) lines.push({ said: 'builder', text: refused })
    let seconds = await released(env, space, spend)
    // ONE write, from one reading of the space: the build and the seconds it
    // compiled for go together, and a conversation that compiled something
    // and shipped nothing pays for the container alone (meter.ts).
    if (built) await countedBuild(env, space, usage, seconds)
    else if (seconds) await countedSandbox(env, space, seconds)
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
  if (!who.person) return await end(ANON)
  // The month's builds (meter.ts, T-34241). It is asked BEFORE anything is
  // spent, and what comes back is a sentence the builder says rather than a
  // door slammed mid-conversation — so a refused build costs the person
  // nothing, not a build and not the tokens of the refusal.
  let full = refusedBuild(space)
  if (full) return await end(full)

  let ctx: Ctx = {
    env,
    // Fresh, every read: a tool answers about what a tool just wrote
    // (directory.ts, mcp.ts).
    dir: directory(bound(env.DIRECTORY, dirPart.fetch, env), true),
    person: who.person,
    spend,
  }
  let model = opts.model ?? modelOf(env, opts.id ?? idOf(env, space))
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
    if (now() - started > ms) return await end(tooLong(ms))
    let answer: Answer
    try {
      answer = await model.ask({ system, said: lines, fns, tokens })
    } catch (e) {
      return await end(
        busy(e) ? BUSY : e instanceof Error ? e.message : String(e),
      )
    }
    rounds++
    usage.input += answer.usage.input
    usage.output += answer.usage.output
    usage.cached += answer.usage.cached
    if (answer.usage.neurons) {
      usage.neurons = (usage.neurons ?? 0) + answer.usage.neurons
    }
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
      // What makes this conversation a BUILD: an app_deploy that went
      // through. A conversation that ships one app costs one build however
      // many turns it took, and one that ships nothing costs none.
      if (c.name == 'app_deploy' && said.ok) built = true
      lines.push({ said: 'tool', call: c.id, name: c.name, text: said.text })
    }
  }
}
