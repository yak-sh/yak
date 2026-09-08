#!/usr/bin/env -S deno run -A
// A graph-native session end to end, in memory, against the model — composed
// from packages only. The graph is @yaks/ram under @yaks/graph; the vocabulary
// is @yaks/session's two documents beside @yaks/model's; the daemon is a
// `created(entry)` effect on @yaks/effects; the model is @yaks/openai over the
// Codex sign-in or OPENAI_API_KEY; the transcript prints through @yaks/render
// and @yaks/text; and the verb rides @yaks/cli's plugin seam.
//
//   deno task session:spike                    # gpt-6-astra
//   MODEL=gpt-5.6-sol deno task session:spike 'What time is it?'
//
// It seeds a provider, a model and two tools, writes one input entry, and
// lets the daemon run until the transcript settles, printing each entry as it
// lands. Then it appends a `stop` and shows nothing happens, and forks from the
// first model call to show the fork replaying its inherited prefix plus its own
// input. Nothing here touches a file except the credential it reads.

import { effects } from '@yaks/effects'
import { type Bundle, type Comp, graph } from '@yaks/graph'
import { modelDoc } from '@yaks/model'
import { credential, responses } from '@yaks/openai'
import { ram } from '@yaks/ram'
import { render } from '@yaks/text'
import { loadVocab } from '@yaks/vocab'
import { type Ctx, main, type Plugin } from '@yaks/cli'
import { sessionDoc } from './comp.ts'
import { daemon } from './daemon.ts'
import { nativeDoc } from './native.ts'
import { native, sessions } from './plugin.ts'
import { kindOf } from './status.ts'
import { type Tool, transcript } from './react.ts'
import { views } from './views.ts'

let tools: Tool[] = [
  {
    name: 'list_tools',
    description: 'the names of the tools you can call here',
    parameters: { type: 'object', properties: {} },
    run: () => tools.map((t) => t.name).join(', '),
  },
  {
    name: 'now',
    description: 'the current time, ISO-8601',
    parameters: { type: 'object', properties: {} },
    run: () => new Date().toISOString(),
  },
]

let spike = async (c: Ctx): Promise<number> => {
  let env = (name: string) => Deno.env.get(name)
  let MODEL = env('MODEL') ?? 'gpt-6-astra'
  let prompt = c.args.join(' ') || 'List your tools, then say done.'

  let vocab = loadVocab([sessionDoc, modelDoc, nativeDoc])
  let fx = effects(vocab)
  let g = graph({
    storage: ram(vocab),
    vocab,
    plugins: [sessions(), native(), fx],
  })
  let model = responses({
    credential: credential(env, (path) => Promise.resolve(c.reads.file(path))),
  })

  let ids = { p: 'openai', m: MODEL, s: 'S1', f: 'S2' }
  let names = Object.fromEntries(tools.map((t) => [`tool:${t.name}`, t.name]))
  let show = (b: Bundle) =>
    c.out('  ' + render(views, b, 'Line', vocab, { names }, 'plain'))
  let status = async (s: string) => {
    let [self] = await g.storage.tx((tx) => tx.get([s]))
    let entries = await transcript(g, s)
    c.out('  ' + render(views, self, 'Status', vocab, { entries }, 'plain'))
  }

  // The Codex backend keeps nothing, so every call replays the transcript and a
  // fork replays its inherited prefix; ANCHORS=1 asks the fast path anyway.
  let d = daemon(g, fx, {
    model,
    tools,
    instructions: 'You are a terse assistant. Use the tools when asked.',
    anchors: env('ANCHORS') == '1',
  }, (step) => step.added.forEach(show))

  c.out(`session ${ids.s}, ${MODEL}:`)
  g.apply([
    { entity: { eid: ids.p }, provider: { name: 'openai' } },
    { entity: { eid: ids.m }, model: { name: MODEL, provider: ids.p } },
    ...tools.map((t) => ({
      entity: { eid: `tool:${t.name}` },
      tool: { name: t.name, description: t.description },
    })),
    { entity: { eid: ids.s }, session: { id: 'spike' }, transcript: {} },
    {
      entity: { eid: 'in1' },
      entry: { session: ids.s, seq: 1, text: prompt },
      input: {},
      using: { provider: ids.p, model: ids.m, effort: 'low' },
    },
  ])
  for (let b of await transcript(g, ids.s)) show(b)
  await d.idle(ids.s)
  await status(ids.s)

  c.out('\nappend a stop:')
  let seq = Math.max(
    ...(await transcript(g, ids.s)).map((b) => Number((b.entry as Comp).seq)),
  ) + 1
  g.apply([{
    entity: { eid: 'stop1' },
    entry: { session: ids.s, seq, text: '' },
    stop: {},
  }])
  await d.idle(ids.s)
  await status(ids.s)

  c.out('\nfork from the first model call, with a new input:')
  let anchor = (await transcript(g, ids.s)).find((b) =>
    kindOf(b) == 'call' && (b.call as Comp).source == null
  )
  if (!anchor) {
    c.note('no model call to fork from')
    return 1
  }
  g.apply([
    {
      entity: { eid: ids.f },
      session: { id: 'spike-fork' },
      transcript: {},
      fork: { from: anchor.entity.eid },
    },
    {
      entity: { eid: 'in2' },
      entry: {
        session: ids.f,
        seq: 100,
        text: 'What time is it? Then say done.',
      },
      input: {},
    },
  ])
  show((await transcript(g, ids.f)).find((b) => b.entity.eid == 'in2')!)
  await d.idle(ids.f)
  await status(ids.s)
  await status(ids.f)
  return 0
}

/** The verb, for a `yak` that carries it. */
export let plugin: Plugin = {
  name: '@yaks/session',
  about: 'a graph-native session, in memory',
  verbs: () => [{
    name: 'spike',
    args: '[prompt]',
    about: 'run one transcript against the model and print it',
    run: spike,
  }],
}

if (import.meta.main) Deno.exit(await main(['spike', ...Deno.args], [plugin]))
