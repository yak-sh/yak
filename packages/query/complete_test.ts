// complete(): the text and the caret in, the candidates out. A case asserts
// one candidate and its label, or its absence, so a test never freezes the
// whole list.

import { assertEquals } from '@std/assert'
import { loadVocab } from '@yaks/vocab'
import { type Cand, complete, type Source } from './complete.ts'

let str = { type: 'string' }
let v = loadVocab([{
  $defs: {
    entity: {
      component: true,
      wire: false,
      properties: { num: { type: 'integer', stamped: true } },
    },
    doc: { component: true, kind: true, properties: { title: str } },
    task: {
      component: true,
      kind: true,
      properties: {
        status: { type: 'string', enum: ['open', 'done'] },
        priority: { type: 'number' },
        domain: str,
        assignee: { type: 'string', ref: 'person' },
      },
    },
    session: {
      component: true,
      kind: true,
      properties: {
        status: { type: 'string', enum: ['running', 'settled'] },
        started: { type: 'string', format: 'date-time', stamped: true },
      },
    },
    person: { component: true, kind: true, properties: {} },
    proposed: { component: true, properties: {} },
    comment: {
      component: true,
      properties: { target: { ...str, ref: 'entity' } },
    },
    card: {
      component: true,
      properties: { target: { ...str, ref: 'entity' } },
    },
    pin: {
      component: true,
      properties: { x: { type: 'number' }, hidden: { type: 'boolean' } },
    },
    _prop: { component: true, properties: { name: str, type: str } },
  },
}])

// The caret is where `§` is, or the end.
let at = (text: string) => {
  let caret = text.indexOf('§')
  return caret < 0 ? { text, caret: text.length } : {
    text: text.replace('§', ''),
    caret,
  }
}
let offered = (text: string, source?: Source<Cand[]>) => {
  let a = at(text)
  let c = complete(v, a.text, a.caret, source)
  return Object.fromEntries(c.cands.map((x) => [x.text, x.kind]))
}

let people: Source<Cand[]> = {
  ids: (ref, pre) =>
    ['jeff', 'jenna', 'T-3'].filter((id) => id.startsWith(pre))
      .map((text) => ({ text, kind: ref })),
  values: (comp, prop) => [{ text: 'Ops', kind: `${comp}.${prop}` }],
  ranks: ['hot', 'similar'],
}

let has: [string, string, string, string | undefined, Source<Cand[]>?][] = [
  ['a component leads on to its properties', '.', '.task.', 'comp'],
  ['a component with none is its own word', '.pro', '.proposed', 'comp'],
  ['a bare property names its component', '.', '.priority', 'task'],
  ['a stamped property says so', '.', '.num', 'entity · stamped'],
  ['a reference says so', '.', '.assignee', 'task · ref'],
  ['a shared reference is one word', '.', '.target', 'ref'],
  ['an ambiguous name waits for the line', '.', '.status', undefined],
  ['the line decides it', '.task .sta', '.status', 'task'],
  ['a line naming both leaves it', '.task .session .sta', '.status', undefined],
  ['the prefix filters', '.pri', '.proposed', undefined],
  ['a _ component is a component', '._', '._prop.', 'comp'],
  ['its properties never stand bare', '.', '.name', undefined],
  ['but read through it', '._prop.', '._prop.name', '_prop'],
  ["a component's columns", '.pin.', '.pin.x', 'pin'],
  ['a stamped column', '.session.', '.session.started', 'session · stamped'],
  ['a column by prefix', '.pin.h', '.pin.hidden', 'pin'],
  ['a whole property takes an operator', '.priority', '.priority<=', 'until'],
  ['and a range', '.priority', '.priority=..', 'range'],
  ['a whole column too', '.pin.x', '.pin.x!=', 'not'],
  ['a component alone asks absence', '.proposed', '!proposed', 'absent'],
  ['or wanted', '.proposed', '?proposed', 'wanted'],
  ['a half operator', '.priority!', '.priority!=', 'not'],
  ['a half contains', '.domain~', '.domain~=', 'contains'],
  ['enum members', '.task.status=', '.task.status=open', 'status'],
  ['enum by prefix', '.task.status=d', '.task.status=done', 'status'],
  [
    'an any-of list, one part at a time',
    '.task.status=open,d',
    '.task.status=open,done',
    'status',
  ],
  [
    'the line decides a value too',
    '.session .status=r',
    '.status=running',
    'status',
  ],
  ['a flag', '.pin.hidden=', '.pin.hidden=1', 'true'],
  ['a time phrase', '.session.started>', '.session.started>today', 'time'],
  ['past a reference, the far side', '.assignee.', '.assignee.title', 'doc'],
  [
    'past a reference, a component',
    '.comment.target.',
    '.comment.target.pin.',
    'comp',
  ],
  [
    'a chain reads the far columns',
    '.comment.target.pin.',
    '.comment.target.pin.x',
    'pin',
  ],
  [
    'a chain leaf takes values',
    '.comment.target.task.status=',
    '.comment.target.task.status=open',
    'status',
  ],
  ['not past a plain column', '.domain.', '.domain.title', undefined],
  ['a reverse association', '.comm', '.comments', 'comment · reverse'],
  ['its children follow', '.cards.', '.cards.target', 'ref'],
  ['a directive', '.lim', '.limit=', 'window'],
  ['an aggregate', '.ta', '.tally=', 'aggregate'],
  ['!: absent components', '!pro', '!proposed', 'comp'],
  ['?: wanted components only', '?pr', '?priority', undefined],
  ['a word after others', '.task .pri', '.priority', 'task'],
  ['a word after a comma clause', '.entity,.pri', '.priority', 'task'],
  ['a word inside a group', '(.pin|.pri', '.priority', 'task'],
  ['a bare word is text, not a clause', 'pri', '.priority', undefined],
  [
    'a reference names entities',
    '.assignee=je',
    '.assignee=jeff',
    'person',
    people,
  ],
  ['a shared one names any', '.target=T', '.target=T-3', 'entity', people],
  [
    'a value the source has seen',
    '.domain=',
    '.domain=Ops',
    'task.domain',
    people,
  ],
  ['a ranking', '.order=h', '.order=hot', 'rank', people],
  [
    'or a property to order by',
    '.order=pri',
    '.order=priority',
    'task',
    people,
  ],
  ['descending', '.order=-pri', '.order=-priority', 'task'],
  ['a tally reads a property', '.tally=pin.', '.tally=pin.x', 'pin'],
  [
    'fields, one part at a time',
    '.fields=pin.x,pin.h',
    '.fields=pin.x,pin.hidden',
    'pin',
  ],
  ['.near names an entity', '.near=je', '.near=jeff', 'entity', people],
  ['mid-line, the word up to the caret', '.pri§ .task', '.priority', 'task'],
]
for (let [name, text, cand, kind, source] of has) {
  Deno.test(`complete: ${name}`, () => {
    assertEquals(offered(text, source)[cand], kind)
  })
}

Deno.test('complete: the word itself is never offered', () => {
  assertEquals(offered('.priority')['.priority'], undefined)
  assertEquals(offered('.task.status=open')['.task.status=open'], undefined)
})

Deno.test('complete: the span is the word under the caret', () => {
  let { from, to } = complete(v, '.task .pri .pin', 10)
  assertEquals([from, to], [6, 10])
  assertEquals(complete(v, '.task.status=open,d').from, 0)
  assertEquals(complete(v, '.entity,.pri').from, 8)
})

Deno.test('complete: an asynchronous source makes the answer a promise', async () => {
  let slow: Source = {
    ids: () => Promise.resolve([{ text: 'jeff', kind: 'person' }]),
  }
  let c = await complete(v, '.assignee=j', undefined, slow)
  assertEquals(c.cands, [{ text: '.assignee=jeff', kind: 'person' }])
})

Deno.test('complete: nothing to offer is an empty list', () => {
  assertEquals(complete(v, '').cands, [])
  assertEquals(complete(v, '"quoted').cands, [])
  assertEquals(complete(v, '.nothing.').cands, [])
})

Deno.test("complete: a _ component follows the application's own", () => {
  let texts = complete(v, '.').cands.map((c) => c.text)
  assertEquals(texts.indexOf('._prop.') > texts.indexOf('.task.'), true)
})
