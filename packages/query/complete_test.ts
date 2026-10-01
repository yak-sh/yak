// complete(): the text and the caret in, the candidates out. A case asserts
// one candidate and its label, or its absence, so a test never freezes the
// whole list.

import { test } from '@yaks/testing'
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
    effect: { component: true, properties: { handler: str } },
    using: { component: true, properties: { effort: str } },
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
    timing: { component: true, properties: {} },
    statusbar: { component: true, properties: {} },
    foo: { component: true, properties: { timing: { type: 'number' } } },
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
  ['a component is its own clause', '.', '.task', 'comp'],
  ['a whole one leads on to its properties', '.task', '.task.', 'comp'],
  ['a component with none is its own word', '.pro', '.proposed', 'comp'],
  ['a property comes with its component', '.', '.task.priority', 'task'],
  ['a stamped property says so', '.', '.entity.num', 'entity · stamped'],
  ['a reference says so', '.', '.task.assignee', 'task · ref'],
  ['the spine names its eid', '.ei', '.entity.eid', 'entity'],
  ['every component a name is on', '.sta', '.task.status', 'task'],
  ['…each of them', '.sta', '.session.status', 'session'],
  ['a property never stands alone', '.sta', '.status', undefined],
  ['the prefix filters', '.pri', '.proposed', undefined],
  ['a _ component is a component', '._', '._prop', 'comp'],
  ['its properties come with it', '.na', '._prop.name', '_prop'],
  ['and read through it', '._prop.', '._prop.name', '_prop'],
  ["a component's columns", '.pin.', '.pin.x', 'pin'],
  ['a stamped column', '.session.', '.session.started', 'session · stamped'],
  ['a column by prefix', '.pin.h', '.pin.hidden', 'pin'],
  [
    'a whole property takes an operator',
    '.task.priority',
    '.task.priority<=',
    'until',
  ],
  ['and a range', '.task.priority', '.task.priority=..', 'range'],
  ['a whole column too', '.pin.x', '.pin.x!=', 'not'],
  ['a component alone asks absence', '.proposed', '!proposed', 'absent'],
  ['or wanted', '.proposed', '?proposed', 'wanted'],
  ['a half operator', '.task.priority!', '.task.priority!=', 'not'],
  ['a half contains', '.task.domain~', '.task.domain~=', 'contains'],
  ['enum members', '.task.status=', '.task.status=open', 'status'],
  ['enum by prefix', '.task.status=d', '.task.status=done', 'status'],
  [
    'an any-of list, one part at a time',
    '.task.status=open,d',
    '.task.status=open,done',
    'status',
  ],
  ['another enum', '.session.status=r', '.session.status=running', 'status'],
  ['a flag', '.pin.hidden=', '.pin.hidden=1', 'true'],
  ['a time phrase', '.session.started>', '.session.started>today', 'time'],
  [
    'past a reference, the far side',
    '.task.assignee.',
    '.task.assignee.doc.title',
    'doc',
  ],
  [
    'past a reference, a component',
    '.comment.target.',
    '.comment.target.pin',
    'comp',
  ],
  [
    'and on to its properties',
    '.comment.target.pin',
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
  [
    'not past a plain column',
    '.task.domain.',
    '.task.domain.doc.title',
    undefined,
  ],
  ['a reverse association', '.comm', '.comments', 'comment · reverse'],
  ['its children follow', '.cards.', '.cards.card.target', 'card · ref'],
  ['a directive', '.lim', '.limit=', 'window'],
  ['an aggregate', '.ta', '.tally=', 'aggregate'],
  ['!: absent components', '!pro', '!proposed', 'comp'],
  ['?: wanted components', '?pr', '?proposed', 'comp'],
  ['?: never a property', '?pr', '?task.priority', undefined],
  ['a word after others', '.task .pri', '.task.priority', 'task'],
  ['a word after a comma clause', '.entity,.pri', '.task.priority', 'task'],
  ['a word inside a group', '(.pin|.pri', '.task.priority', 'task'],
  ['a bare word is text, not a clause', 'pri', '.task.priority', undefined],
  [
    'a reference names entities',
    '.task.assignee=je',
    '.task.assignee=jeff',
    'person',
    people,
  ],
  [
    'any entity, where any is named',
    '.comment.target=T',
    '.comment.target=T-3',
    'entity',
    people,
  ],
  ['an eid names any', '.entity.eid=T', '.entity.eid=T-3', 'entity', people],
  [
    'a value the source has seen',
    '.task.domain=',
    '.task.domain=Ops',
    'task.domain',
    people,
  ],
  ['a ranking', '.order=h', '.order=hot', 'rank', people],
  [
    'or a property to order by',
    '.order=pri',
    '.order=task.priority',
    'task',
    people,
  ],
  ['descending', '.order=-pri', '.order=-task.priority', 'task'],
  ['a tally reads a property', '.tally=pin.', '.tally=pin.x', 'pin'],
  [
    'fields, one part at a time',
    '.fields=pin.x,pin.h',
    '.fields=pin.x,pin.hidden',
    'pin',
  ],
  ['.near names an entity', '.near=je', '.near=jeff', 'entity', people],
  [
    'mid-line, the word up to the caret',
    '.pri§ .task',
    '.task.priority',
    'task',
  ],
]
for (let [name, text, cand, kind, source] of has) {
  test(`complete: ${name}`, () => {
    assertEquals(offered(text, source)[cand], kind)
  })
}

test('complete: the word itself is never offered', () => {
  assertEquals(offered('.task.priority')['.task.priority'], undefined)
  assertEquals(offered('.task.status=open')['.task.status=open'], undefined)
})

test('complete: the span is the word under the caret', () => {
  let { from, to } = complete(v, '.task .pri .pin', 10)
  assertEquals([from, to], [6, 10])
  assertEquals(complete(v, '.task.status=open,d').from, 0)
  assertEquals(complete(v, '.entity,.pri').from, 8)
})

test('complete: an asynchronous source makes the answer a promise', async () => {
  let slow: Source = {
    ids: () => Promise.resolve([{ text: 'jeff', kind: 'person' }]),
  }
  let c = await complete(v, '.task.assignee=j', undefined, slow)
  assertEquals(c.cands, [{ text: '.task.assignee=jeff', kind: 'person' }])
})

test('complete: nothing to offer is an empty list', () => {
  assertEquals(complete(v, '').cands, [])
  assertEquals(complete(v, '"quoted').cands, [])
  assertEquals(complete(v, '.nothing.').cands, [])
})

let texts = (text: string) => Object.keys(offered(text))

// `a` is offered, and before `b`.
let before = (text: string, a: string, b: string) => {
  let got = texts(text)
  assertEquals(got.includes(a) && got.indexOf(a) < got.indexOf(b), true, a)
}

test("complete: a _ component follows the application's own", () => {
  before('.', '.task', '._prop')
})

test('complete: a component comes first, as the word it reads', () => {
  assertEquals(texts('.eff')[0], '.effect')
})

test('complete: a prefix offers components, then properties with theirs', () => {
  before('.ti', '.timing', '.foo.timing')
  before('.ti', '.foo.timing', '.doc.title')
})

test('complete: an exact name comes first', () => {
  before('.status', '.session.status', '.statusbar')
  before('.status', '.task.status', '.statusbar')
})

test('complete: what the line names comes next', () => {
  before('.sta', '.session.status', '.task.status')
  before('.task .sta', '.task.status', '.session.status')
  before('.sta§ .task.priority=1', '.task.status', '.session.status')
})

test('complete: a whole word says so, and reads on before it is rewritten', () => {
  let whole = (text: string) => complete(v, text).whole
  for (
    let w of ['.effect', '.task.priority', '!effect', '.task.status=open']
  ) {
    assertEquals(whole(w), true, w)
  }
  for (let w of ['.eff', '.effect.', '.status', '.priority', '.priority!']) {
    assertEquals(whole(w), false, w)
  }
  assertEquals(texts('.effect')[0], '.effect.')
})
