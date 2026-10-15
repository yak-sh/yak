import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { type Bundle, type Graph, graph, type Storage } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { effects } from './registry.ts'
import { blog } from './testing.ts'

let targets = [
  '.post.published=true',
  '.post.ready=true',
  '.entity.eid=C-2 .comment.post.post.published=true',
]
let vocabularies = new Map(
  targets.map((target) => [
    target,
    loadVocab([
      ...blog.docs.map((doc) => ({
        ...doc,
        $defs: {
          ...doc.$defs,
          post: {
            ...doc.$defs!.post,
            properties: {
              ...doc.$defs!.post.properties,
              ready: { type: 'boolean', computed: true },
            },
          },
        },
      })),
      {
        $defs: {
          note: {
            effect: true,
            created: ['post', 'comment'],
            changed: ['post', 'comment'],
            removed: ['post', 'comment'],
            target,
          },
        },
      },
    ]),
  ]),
)

// A graph whose `note` effect is scoped by `target`, with `seed` written at
// load, so a case times only the write it is about. What the seed was seen
// to do, and read, stays for the case to check.
let fixture = (target: string, ...seed: Bundle[][]) => {
  let vocab = vocabularies.get(target)!
  let seen: string[] = []
  let reads = 0
  let base = ram(vocab, {
    number: true,
    computed: {
      'post.ready': (b) => (b.post as { published?: boolean })?.published,
    },
  })
  let storage: Storage = {
    ...base,
    tx: (body) =>
      base.tx((tx) =>
        body({
          ...tx,
          read: (...args) => {
            reads++
            return tx.read(...args)
          },
        })
      ),
  }
  let fx = effects(vocab)
  fx.handle({ note: (e) => seen.push(`${e.kind} ${e.entity.eid}`) })
  let g: Graph = graph({ vocab, storage, plugins: [fx] })
  for (let batch of seed) g.apply(batch)
  return { g, seen, reads: () => reads }
}

let post = (eid: string, published: boolean) => ({
  entity: { eid },
  post: { title: eid, published },
})
let births = [post('guest-0', true), post('outside', false)]
let moves = [post('guest-0', false), post('outside', true)]

// A stored property's membership comes from the transaction's own facts,
// reading nothing; a computed one's comes from storage, and selects and
// reconciles subjects the same way.
for (
  let [kind, target, source] of [
    ['local', '.post.published=true', 'transaction facts'],
    ['computed', '.post.ready=true', 'storage'],
  ]
) {
  let unread = (f: ReturnType<typeof fixture>) =>
    source == 'storage' || assertEquals(f.reads(), 0)
  let born = fixture(target)
  test(`${kind} effect targets select canonical births from ${source}`, () => {
    born.g.apply(births)
    unread(born)
    assertEquals(born.seen, ['created guest-0'])
  })

  let moved = fixture(target, births)
  test(`${kind} effect targets reconcile subjects leaving and entering scope from ${source}`, () => {
    moved.g.apply(moves)
    unread(moved)
    assertEquals(moved.seen, [
      'created guest-0',
      'changed guest-0',
      'changed outside',
    ])
  })

  let gone = fixture(target, births, moves)
  test(`${kind} effect targets see a subject in scope removed`, () => {
    gone.g.apply([{ entity: { eid: 'outside' }, post: null }])
    assertEquals(gone.seen, [
      'created guest-0',
      'changed guest-0',
      'changed outside',
      'removed outside',
    ])
  })
}

let relational = '.entity.eid=C-2 .comment.post.post.published=true'
let parent = [post('parent', true)]
let comment = (text?: string) => ({
  entity: { eid: 'guest-0' },
  comment: { post: 'parent', text },
})
let related = fixture(relational, parent)
test('relational effect targets address a created subject by human reference', () => {
  related.g.apply([comment('Hello')])
  assertEquals(related.seen, ['created guest-0'])
})

let unrelated = fixture(relational, parent, [comment('Hello')])
test('relational effect targets address a removed subject by human reference', () => {
  unrelated.g.apply([{ entity: { eid: 'guest-0' }, $delete: true }])
  assertEquals(unrelated.seen, ['created guest-0', 'removed guest-0'])
})

let doomed = loadVocab([...blog.docs, {
  $defs: {
    note: { effect: true, removed: ['comment'], target: '.comment.text=kept' },
  },
}])
let cascaded: string[] = []
let ending = graph({
  vocab: doomed,
  storage: ram(doomed),
  plugins: [
    effects(doomed).handle({ note: (e) => cascaded.push(e.entity.eid) }),
  ],
})
let remark = (eid: string, text: string) => ({
  entity: { eid },
  comment: { post: 'parent', text },
})
ending.apply([
  post('parent', true),
  remark('c1', 'kept'),
  remark('c2', 'other'),
])
test('effect targets scope what a cascade deletes by what it was', () => {
  ending.apply([{ entity: { eid: 'parent' }, $delete: true }])
  assertEquals(cascaded, ['c1'])
})

let guestBrowser = '00000000-0000-4000-8000-000000000001'
let signedBrowser = '00000000-0000-4000-8000-000000000002'
let stamps = loadVocab(blog.docs.map((doc) => ({
  ...doc,
  $defs: {
    ...doc.$defs,
    updated: {
      ...doc.$defs!.updated,
      properties: {
        ...doc.$defs!.updated.properties,
        via: { type: 'string', stamped: true },
      },
    },
    note: {
      effect: true,
      changed: ['updated'],
      target: `.updated.via=${guestBrowser}`,
    },
  },
})))
let stamped = effects(stamps), exits: string[] = []
stamped.handle({ note: (e) => exits.push(e.entity.eid) })
let writing = graph({
  vocab: stamps,
  storage: ram(stamps),
  plugins: [stamped],
})
writing.apply([post('guest-0', false)])
writing.apply([{
  ...post('guest-0', true),
  $actor: { via: guestBrowser },
}])
exits.length = 0
test('automatic stamp triggers retain subjects leaving their prior target scope', () => {
  writing.apply([{
    ...post('guest-0', false),
    $actor: { via: signedBrowser },
  }])
  assertEquals(exits, ['guest-0'])
})

let pattern = effects(blog), matches: string[] = []
pattern.on('.post.published=true', (e) => matches.push(e.entity.eid))
let patterned = graph({
  vocab: blog,
  storage: ram(blog),
  plugins: [pattern],
})
test('single-entity matched triggers select canonical changed subjects', () => {
  patterned.apply([post('guest-0', true)])
  assertEquals(matches, ['guest-0'])
})
