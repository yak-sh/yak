import { equal, test } from '@yaks/testing'
import { type Bundle, graph } from '@yaks/graph'
import { link } from '@yaks/edge'
import { human } from '@yaks/id'
import { notifyDoc } from '@yaks/notify/vocab'
import { mailDoc } from '@yaks/mail/vocab'
import { provenanceDoc } from '@yaks/provenance'
import { loadVocab } from '@yaks/vocab'
import { ram } from '@yaks/ram'
import { sessions } from '@yaks/session'
import { hear, pending } from '../session/listen.ts'
import { host } from './testing.ts'
import { complete, reportOf } from './completion.ts'

let vocab = loadVocab(
  [...host.docs, notifyDoc, provenanceDoc, mailDoc],
  host.keywords,
)
let bare = (rows: Bundle[]) => {
  let storage = ram(vocab, { number: true })
  storage.tx((tx) => tx.patch(rows))
  return graph({ vocab, storage, plugins: [sessions()] })
}

let entry = (eid: string, seq: number, comps: object): Bundle => ({
  entity: { eid },
  entry: { session: 'child', seq },
  ...comps,
})
let rows: Bundle[] = [
  { entity: { eid: 'parent' }, session: {} },
  {
    entity: { eid: 'spawn-call' },
    call: { to: 'spawn-tool', args: { task: 'work' } },
    entry: { session: 'parent', seq: 1 },
  },
  { entity: { eid: 'work' }, task: {}, doc: { title: 'The work' } },
  {
    entity: { eid: 'child' },
    session: { source: 'spawn-call' },
    process: { pid: 42 },
    exit: { code: 0 },
  },
  entry('request', 1, { using: {}, content: { body: 'do the work' } }),
  entry('report', 2, {
    output: {},
    content: { body: 'Fixed it; checks pass.' },
  }),
  entry('thinking', 3, {
    output: {},
    reasoning: {},
    content: { body: 'private' },
  }),
  entry('result', 4, {
    output: {},
    result: { call: 'tool' },
    content: { body: 'tool output' },
  }),
  entry('end', 5, { stop: {}, ask: { through: 'request' } }),
]
let finished = bare(rows)
let failure = bare(
  rows.map((b) => b.entity.eid == 'child' ? { ...b, exit: { code: 9 } } : b),
)
let quiet = bare(
  rows.filter((b) => !['report', 'thinking', 'result'].includes(b.entity.eid)),
)
let live = bare(
  rows.map((b) => b.entity.eid == 'child' ? { ...b, exit: undefined } : b),
)
let waiting = bare([
  ...rows,
  { entity: { eid: 'work' }, claim: { session: 'child' } },
  { entity: { eid: 'dependency' }, task: {} },
  link('work', 'requires', 'dependency'),
])
let continuing = bare([
  ...rows,
  entry('continuation', 6, { using: {}, content: { body: 'Next step' } }),
])
let name = async (g: typeof finished) =>
  human(g.vocab)((await g.get(['child'], ['session']))[0])
let delivered = bare(rows)
await complete(delivered, 'child')
let heard: string[] = []
await hear(delivered, null, 'parent', (line) => heard.push(line))
let listening = bare(rows)
await complete(listening, 'child')

test('an ended run saves its spoken report after its claim is gone', async () => {
  await complete(finished, 'child')
  let [report] = await finished.read('.comment.target=work&*')
  equal(
    (report.doc as { body: string }).body,
    `${await name(finished)} — exited 0\n\nFixed it; checks pass.`,
  )
  equal(report.knock, { target: 'parent' })
})

test('the spawning session hears its child report through the listener', async () => {
  let lines: string[] = []
  await hear(listening, null, 'parent', (line) => lines.push(line))
  equal(lines.length, 1)
  equal(lines[0].includes('Fixed it; checks pass.'), true)
})

test('replaying a completion preserves its report and delivery receipt', async () => {
  await complete(delivered, 'child')
  equal((await delivered.read('.comment.target=work')).length, 1)
  equal((await pending(delivered, 'parent')).length, 0)
  equal(heard.length, 1)
})

test('a failed run reports its exit and preserves the last account of its work', async () => {
  await complete(failure, 'child')
  let [report] = await failure.read('.comment.target=work&*')
  equal(
    (report.doc as { body: string }).body,
    `${await name(failure)} — exited 9\n\nFixed it; checks pass.`,
  )
})

test('a run with no spoken output still reports its ending', async () => {
  await complete(quiet, 'child')
  let [report] = await quiet.read('.comment.target=work&*')
  equal(
    (report.doc as { body: string }).body,
    `${await name(quiet)} — exited 0`,
  )
})

for (
  let [name, g] of [['running', live], ['parked', waiting], [
    'continuing',
    continuing,
  ]] as const
) {
  test(`a ${name} run owes no completion`, async () => {
    await complete(g, 'child')
    equal((await g.read('.comment|.knock')).length, 0)
  })
}

test('a session brief takes precedence over imported spoken output', () => {
  equal(
    reportOf({ entity: { eid: 'child' }, brief: { text: 'My report' } }, rows),
    'My report',
  )
})
