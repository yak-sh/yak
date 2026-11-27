// A call runs as whoever wrote it, however it was written: through a door,
// by a rule inside the write, or by an effect after the commit, which signs
// its write with the commit's actor (@yaks/effects `Event.actor`).
import { test, until } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import {
  type Actor,
  type Bundle,
  type Comp,
  graph,
  signed,
  who,
} from '@yaks/graph'
import { effectDoc, effects } from '@yaks/effects'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { kernelDoc } from '@yaks/kernel'
import { provenanceDoc } from '@yaks/provenance'
import { executionComputed, runner, toolEid, toolsDoc } from './mod.ts'

let ada = { by: 'ada', via: 'session' }
let ask = { to: toolEid('echo'), args: {} }

// A graph whose rule asks inside the write and whose effect asks after it,
// each for the entity an `ask{how}` names, run by `pooled` effect rows or not.
let world = async (pooled: boolean) => {
  let vocab = loadVocab([
    kernelDoc,
    provenanceDoc,
    toolsDoc,
    ...pooled ? [effectDoc] : [],
    {
      $defs: {
        ask: { component: true, properties: { how: { type: 'string' } } },
        ask_after: { effect: true, created: ['ask'] },
      },
    },
  ])
  let fx = effects(vocab, {
    defer: pooled,
    write: (b) => g.apply(b, { trusted: true }),
    report: (e) => {
      throw e
    },
  })
  let g = graph({
    vocab,
    storage: ram(vocab, { computed: executionComputed }),
    plugins: [fx],
  })
  let seen = new Map<string, Actor | null>()
  let r = runner(g, {
    tools: [{
      name: 'echo',
      description: 'Say who asked',
      run: (call: Bundle) => {
        seen.set(call.entity.eid, who(call))
        return [{
          entity: { eid: `answer-${call.entity.eid}` },
          output: { source: call.entity.eid },
        }]
      },
    }],
  })
  await r.ensure()
  fx.handle(Object.fromEntries(r.rules.map((p) => [
    p.rule.name,
    (e: { entity: { eid: string } }) => r.due(e.entity.eid),
  ])))
  g.use({
    name: 'asking',
    rules: [{
      phase: 'rules',
      match: '.ask, ask.how=write, +!call',
      produce: { call: ask },
    }],
  })
  fx.handle({
    ask_after: async (e, _, write) => {
      if (e.comp?.how != 'commit') return
      await write(signed(
        [{ entity: { eid: `${e.entity.eid}-call` }, call: ask }],
        e.actor ?? null,
      ))
    },
  })
  await g.apply(['ada', 'session'].map((eid) => ({
    entity: { eid },
    content: { body: eid },
  })))
  // Drive the pool until every call has its answer.
  let ran = async (eid: string) => {
    await until(async () => {
      if (pooled) await fx.work(g, AbortSignal.abort(), 1)
      return seen.has(eid)
    })
    let [answer] = await g.get([`answer-${eid}`])
    return { ran: seen.get(eid), wrote: answer?.created as Comp | undefined }
  }
  return { g, ran }
}

let doors: [string, Bundle, string][] = [
  ['a door', { entity: { eid: 'door' }, call: ask }, 'door'],
  ['a rule in the write', {
    entity: { eid: 'rule' },
    ask: { how: 'write' },
  }, 'rule'],
  ['an effect after commit', {
    entity: { eid: 'effect' },
    ask: { how: 'commit' },
  }, 'effect-call'],
]

for (let pooled of [false, true]) {
  for (let [name, bundle, call] of doors) {
    test(`a call written by ${name} runs as its writer (${pooled ? 'pooled' : 'in process'})`, async () => {
      let { g, ran } = await world(pooled)
      await g.apply([{ ...bundle, $actor: ada }])
      let { ran: actor, wrote } = await ran(call)
      assertEquals(actor, ada)
      assertEquals({ by: wrote?.by, via: wrote?.via }, ada)
    })
  }
}
