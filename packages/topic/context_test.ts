// A topic compiled as a session's context, over a small graph: where it sits,
// its cover and contents, what it holds in full, the outline below it with its
// cycle cut, what it needs, relates to and cites, and what is cut or listed
// once a body or the whole runs long.
import { equal, ok, test } from '@yaks/testing'
import { type Bundle, graph, Refused, token } from '@yaks/graph'
import { loadVocab } from '@yaks/vocab'
import { ram } from '@yaks/ram'
import { edgeDoc, edgeKeywords, link } from '@yaks/edge'
import { kernelDoc, kernelKeywords } from '@yaks/kernel/vocab'
import { docDoc } from '@yaks/doc/vocab'
import { taskDoc } from '@yaks/task/vocab'
import { toolsDoc } from '@yaks/tools/vocab'
import { topicDoc } from './vocab.ts'
import { BUDGET, compile, CUT, gather } from './context.ts'
import { runs } from './tools.ts'

let vocab = loadVocab([
  kernelDoc,
  edgeDoc,
  docDoc,
  taskDoc,
  toolsDoc,
  topicDoc,
  { $defs: { session: { component: true, type: 'object', kind: true } } },
], [kernelKeywords, edgeKeywords])

let topic = (eid: string, title: string, more: Bundle = { entity: { eid } }) =>
  ({
    ...more,
    entity: { eid },
    topic: { name: title.toLowerCase() },
    doc: { title, body: `What belongs under ${title}.` },
  }) as Bundle
let doc = (
  eid: string,
  title: string,
  body = `${title}, in full.`,
): Bundle => ({
  entity: { eid },
  doc: { title, body },
})
// Paragraphs of `size` characters each, `n` of them.
let long = (n: number, size: number) =>
  Array.from({ length: n }, (_, i) => String(i).padEnd(size, '.'))
    .join('\n\n')

let store = ram(vocab)
let bulky = Array.from({ length: 30 }, (_, i) => `b${i}`)
store.tx((tx) =>
  tx.patch([
    topic('world', 'World'),
    topic('data', 'Data', {
      entity: { eid: 'data' },
      content: { body: 'An entity is its id.' },
    }),
    topic('model', 'Model'),
    topic('ids', 'Ids'),
    topic('deep', 'Deep'),
    topic('deeper', 'Deeper'),
    // A cover running on, as a project's does: a line names it by its first
    // paragraph.
    {
      ...topic('naming', 'Naming'),
      doc: { title: 'Naming', body: 'What belongs under Naming.\n\nAnd more.' },
    },
    topic('big', 'Big'),
    doc('guide', 'The guide', long(6, 1000)),
    { entity: { eid: 'said' }, content: { body: 'Jeff said it.' } },
    {
      entity: { eid: 'quote' },
      content: { body: `${'word '.repeat(30)}\nmore` },
    },
    doc('spec', 'The spec'),
    doc('aside', 'An aside'),
    doc('source', 'A source'),
    doc('inner', 'Inner'),
    link('world', 'contains', 'data'),
    link('data', 'contains', 'model', 1),
    link('data', 'contains', 'guide', 2),
    link('data', 'contains', 'said', 3),
    link('model', 'contains', 'spec', 1),
    link('model', 'contains', 'quote', 3),
    link('model', 'contains', 'ids', 2),
    link('ids', 'contains', 'data'),
    link('ids', 'contains', 'deep'),
    link('deep', 'contains', 'deeper'),
    link('deeper', 'contains', 'inner'),
    link('data', 'requires', 'naming'),
    link('data', 'reads', 'aside'),
    link('data', 'cites', 'source'),
    ...bulky.flatMap((eid, i) => [
      doc(eid, `Bulk ${i}`, long(1, 3990)),
      link('big', 'contains', eid, i),
    ]),
  ])
)
let g = graph({ storage: store, vocab, plugins: [] })
let read = async (eid: string) => compile(vocab)((await gather(g)(eid))!)
let data = await read('data')
let big = await read('big')
let naming = await read('naming')
// A section's text, from its heading to the next.
let section = (text: string, heading: string) =>
  (text.split(`## ${heading}\n\n`)[1]?.split(/\n\n(## |---)/)[0] ?? '').trim()

test('a topic opens with its title, its cover, where it sits and its contents', () => {
  ok(data.startsWith('# #data Data\n\nWhat belongs under Data.'))
  // Root first; Ids holds Data too, so the cycle through Model ends there.
  equal(section(data, 'Within').split('\n'), [
    '- #model Model: What belongs under Model.',
    '- #ids Ids: What belongs under Ids.',
    '- #world World: What belongs under World.',
  ])
  ok(data.includes('## Contents\n\nAn entity is its id.'))
  ok(data.includes(JSON.stringify({
    content: { body: token('An entity is its id.') },
  })))
  ok(naming.includes('Nothing is written here yet.'))
})

test('what it holds is carried in full, in edge order, a subtopic only below', () => {
  let parts = data.split('\n\n---\n\n').map((p) => p.split('\n')[0])
  equal(parts.slice(1, 3), ['# #guide The guide', '# #said'])
  ok(data.includes('# #said\n\nJeff said it.'))
  ok(!parts.some((p) => p.includes('Model')))
})

test('below it, an outline four levels deep that draws each topic once', () => {
  equal(section(data, 'Below').split('\n'), [
    '- #model Model: What belongs under Model.',
    '  - #spec The spec',
    `  - #quote ${'word '.repeat(16).trimEnd()}…`,
    '  - #ids Ids: What belongs under Ids.',
    '    - #deep Deep: What belongs under Deep.',
    '      - #deeper Deeper: What belongs under Deeper.',
  ])
})

test('what to understand first, what is related and its sources, a line each', () => {
  equal(
    section(data, 'Understand first'),
    '- #naming Naming: What belongs under Naming.',
  )
  equal(section(data, 'Related'), '- #aside An aside')
  equal(section(data, 'Sources'), '- #source A source')
})

test('a long body is cut at a paragraph, and the rest named by its id', () => {
  let guide = data.split('\n\n---\n\n')[1]
  ok(guide.length < CUT + 100)
  ok(guide.endsWith('more characters: graph_show #guide.'))
})

test('past the budget, what it holds is listed, never dropped', () => {
  let carried = big.split('\n\n---\n\n').length - 2
  equal(carried, Math.floor(BUDGET / 3990))
  equal(section(big, 'Also held').split('\n').length, 30 - carried)
})

// What topic_read answers for a topic, and for what is no topic, asked once.
let asked = async (topic: string) => {
  try {
    let call = { entity: { eid: 'c' }, call: { args: { topic } } }
    let [answer] = await runs().topic_read!(call, g) as Bundle[]
    return (answer.content as { body: string }).body
  } catch (error) {
    return error
  }
}
let answered = await asked('data')
let refused = await asked('spec')

test('topic_read answers the compiled topic, and refuses what is no topic', () => {
  equal(answered, data)
  ok(refused instanceof Refused)
})
