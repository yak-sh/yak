// A text that arrived knocks whoever it answers, committed and run as
// `session_texted` is: the session that texted its number, its project's
// operator once that session is over, or the project the number it reached
// is filed under.

import { type Bundle, graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { effects } from '@yaks/effects'
import { idKeywords } from '@yaks/id'
import { kernelDoc, kernelKeywords } from '@yaks/kernel'
import { provenanceDoc } from '@yaks/provenance'
import { docDoc } from '@yaks/doc'
import { mailDoc } from '@yaks/mail/vocab'
import { notifyDoc } from '@yaks/notify/vocab'
import { phoneDoc } from '@yaks/phone/vocab'
import { taskDoc } from '@yaks/task'
import { toolsDoc } from '@yaks/tools/vocab'
import { personaDoc } from '@yaks/persona/vocab'
import { projectDoc } from '@yaks/project/vocab'
import { equal, test } from '@yaks/testing'
import { sessionDoc } from './comp.ts'
import { statusComputed } from './state.ts'
import { running } from './run.ts'

let vocab = loadVocab([
  kernelDoc,
  provenanceDoc,
  docDoc,
  mailDoc,
  notifyDoc,
  phoneDoc,
  taskDoc,
  sessionDoc,
  toolsDoc,
  personaDoc,
  projectDoc,
], [kernelKeywords, idKeywords])

let JEFF = '+12695550142'
let OURS = '+12695550100'

let agent = (id: string, more = {}) => ({
  entity: { eid: id },
  session: { id, persona: 'taskmaster', ...more },
})

// A project with its persona and operator, a worker, one that is over, Jeff
// at his number, and the box's number filed under the project.
let box = async () => {
  let fx = effects(vocab)
  let g = graph({
    storage: ram(vocab, { computed: statusComputed, number: true }),
    vocab,
    plugins: [fx],
  })
  let { session_texted } = running(g, {
    holder: 'w',
    model: () => Promise.reject(new Error('no turn is taken here')),
    tools: [],
  })
  fx.handle({ session_texted })
  await g.apply([
    { entity: { eid: 'p' }, project: {} },
    { entity: { eid: 'taskmaster' }, persona: { home: 'p' } },
    {
      entity: { eid: 'jeff' },
      doc: { title: 'Jeff' },
      phone: { number: JEFF },
    },
    {
      entity: { eid: 'ours' },
      phone: { number: OURS },
      filed: { project: 'p' },
    },
    agent('operator', { operator: true }),
    agent('worker'),
    agent('gone', { ended: true }),
  ], { trusted: true })
  return g
}

// A text that left for Jeff, written by `via`.
let sent = (via: string): Bundle => ({
  entity: { eid: `to-jeff-${via}` },
  doc: { body: 'Deployed.' },
  text: { to: JEFF, from: OURS },
  deliver: { to: 'jeff', tried: '2026-11-06T00:00:00Z' },
  delivered: { at: '2026-11-06T00:00:01Z' },
  $actor: { by: 'taskmaster', via },
})

// Jeff's text arriving, and the knocks it left, each without the text's id.
let arrive = async (g: Awaited<ReturnType<typeof box>>) => {
  await g.apply([{
    entity: { eid: 'back' },
    doc: { body: 'thanks' },
    text: { from: JEFF, to: OURS, at: '2026-11-06T00:01:00Z' },
  }], { trusted: true })
  await new Promise((r) => setTimeout(r, 0))
  return (await g.read('.knock ?doc')).map((b) => ({
    target: (b.knock as { target: string }).target,
    body: (b.doc as { body: string }).body.replace(/^text \S+ /, ''),
  }))
}

let cases: [string, string | null, string][] = [
  ['the session that texted him', 'worker', 'worker'],
  ['its operator once that session is over', 'gone', 'operator'],
  ['the operator of the project its number is filed under', null, 'operator'],
]
for (let [who, via, target] of cases) {
  test(`a text back from Jeff knocks ${who}`, async () => {
    let g = await box()
    if (via) await g.apply([sent(via)], { trusted: true })
    equal(await arrive(g), [{
      target,
      body: `from Jeff (${JEFF}): thanks`,
    }])
  })
}

test('a text that asks to go knocks nobody', async () => {
  let g = await box()
  await g.apply([sent('worker')], { trusted: true })
  equal((await g.read('.knock')).length, 0)
})
