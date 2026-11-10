import { type Bundle, type Comp, graph, hook } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { kernelDoc } from '@yaks/kernel/vocab'
import { formsDoc } from '@yaks/forms/vocab'
import { phoneDoc } from '@yaks/phone'
import { equal, test, throws } from '@yaks/testing'
import { storage } from '@yaks/durable-object'
import { durable } from '../../packages/durable-object/testing.ts'
import { directoryForms, directoryPhone } from './form-directory.ts'

let text = { type: 'string' }
let vocab = loadVocab([kernelDoc, formsDoc, phoneDoc, {
  $defs: {
    individual: {
      component: true,
      properties: {
        first: text,
        last: text,
        phone: text,
        email: text,
        born: text,
        status: text,
      },
    },
    doc: { component: true, properties: { body: text } },
    relation: {
      component: true,
      properties: {
        kind: text,
        a: { ...text, ref: 'entity' },
        b: { ...text, ref: 'entity' },
      },
    },
  },
}])
let setup = async (seed: Bundle[] = []) => {
  let g = graph({
    vocab,
    storage: ram(vocab),
    plugins: [directoryForms(vocab)],
  })
  await g.apply([
    { entity: { eid: 'form' }, form: {} },
    ...['first', 'last', 'phone', 'email', 'born'].map((prop) => ({
      entity: { eid: prop },
      question: {
        form: 'form',
        label: prop,
        kind: 'line',
        fills: `individual.${prop}`,
      },
    })),
    ...([['children', 'child'], ['partner', 'spouse'], ['others']] as const)
      .flatMap(([repeat, relates]) => [
        {
          entity: { eid: repeat },
          question: { form: 'form', label: repeat, kind: 'repeat', relates },
        },
        ...['first', 'born'].map((prop) => ({
          entity: { eid: `${repeat.slice(0, 5)}-${prop}` },
          question: {
            form: 'form',
            label: prop,
            kind: 'line',
            fills: `individual.${prop}`,
            within: repeat,
          },
        })),
      ]),
    {
      entity: { eid: 'hidden' },
      question: {
        form: 'form',
        label: 'Hidden',
        kind: 'line',
        fills: 'individual.last',
        when: { question: 'first', is: 'show' },
      },
    },
    ...seed,
  ])
  return g
}
let sign = (
  answers: object,
) => [{ entity: { eid: 'signup' }, registration: { form: 'form', answers } }]
let fixture = {
  entity: { eid: 'member' },
  individual: {
    first: 'Ann',
    phone: '(269) 555-0142',
    email: 'Ann@Example.org',
    status: 'member',
  },
}
let phoned = await setup([fixture])
let emailed = await setup([fixture])
let guests = await setup()
let retry = await setup([fixture])
await retry.apply(
  sign({ phone: '+12695550142', children: [{ 'child-first': 'Bo' }] }),
)
let original = (await retry.read('.relation'))[0]
let phones = await setup([fixture])
let cleared = await setup([fixture])
let together = await setup()
let shared = await setup([fixture])
await shared.apply([{
  entity: { eid: 'child-phone' },
  question: {
    form: 'form',
    label: 'Phone',
    kind: 'phone',
    fills: 'individual.phone',
    within: 'children',
  },
}])
let partial = await setup([fixture])
await partial.apply(
  sign({ first: 'Different', children: [{ 'child-first': 'Bo' }] }),
)
let provisional =
  ((await partial.get(['signup']))[0].registration as Comp).person

test('a phone match fills blanks and preserves differing answers on the registration', async () => {
  let answers = {
    phone: '+1 269 555 0142',
    first: 'Different',
    last: 'Smith',
    hidden: 'stale',
  }
  await phoned.apply(sign(answers))
  let [person] = await phoned.get(['member'])
  let [registration] = await phoned.get(['signup'])
  equal((registration.registration as Comp).person, 'member')
  equal((registration.registration as Comp).answers, answers)
  equal((person.individual as Comp).first, 'Ann')
  equal((person.individual as Comp).last, 'Smith')
  equal(person.phone, { number: '+12695550142' })
})

test('email matching trims and folds case without a phone', async () => {
  await emailed.apply(sign({ email: ' ann@example.ORG ', born: '1980-01-02' }))
  let [row] = await emailed.get(['member'])
  equal((row.individual as Comp).born, '1980-01-02')
  equal(
    ((await emailed.get(['signup']))[0].registration as Comp).person,
    'member',
  )
})

test('an unmatched sign-up creates guests and child-to-parent links', async () => {
  await guests.apply(
    sign({
      first: 'New',
      children: [{ 'child-first': 'Bo' }, { 'child-first': 'Cy' }],
    }),
  )
  let people = await guests.read('.individual')
  let links = await guests.read('.relation')
  let parent = ((await guests.get(['signup']))[0].registration as Comp).person
  equal(people.length, 3)
  equal(people.every((p) => (p.individual as Comp).status == 'guest'), true)
  equal(links.map((l) => (l.relation as Comp).a), [parent, parent])
  equal(links.every((l) => (l.relation as Comp).kind == 'parent'), true)
})

test('partial answers reuse a repeat child and fill only its empty fields', async () => {
  await retry.apply(
    sign({
      phone: '+12695550142',
      children: [{ 'child-first': 'Changed', 'child-born': '2020-03-04' }],
    }),
  )
  let links = await retry.read('.relation')
  equal(links.length, 1)
  equal(links[0].entity.eid, original.entity.eid)
  let child = (await retry.get([String((original.relation as Comp).b)]))[0]
  equal((child.individual as Comp).first, 'Bo')
  equal((child.individual as Comp).born, '2020-03-04')
})

test('ordinary directory phone edits also write the matchable number', async () => {
  await phones.apply([{
    entity: { eid: 'member' },
    individual: { phone: '+44 20 7946 0018' },
  }])
  equal((await phones.get(['member']))[0].phone, { number: '+442079460018' })
})

test('clearing a directory phone removes its matchable number', async () => {
  await cleared.apply([{
    entity: { eid: 'member' },
    individual: { phone: null },
  }])
  equal((await cleared.get(['member']))[0].phone, {})
})

test('the phone repair is idempotent and keeps the typed source intact', () => {
  let patch = directoryPhone(fixture)
  equal(patch.phone, { number: '+12695550142' })
  equal(directoryPhone(patch), patch)
  equal(fixture.individual.phone, '(269) 555-0142')
})

test('a sign-up matches an individual created in the same transaction', async () => {
  await together.apply([
    fixture,
    ...sign({ phone: '+12695550142', last: 'Smith' }),
  ])
  equal(
    ((await together.get(['signup']))[0].registration as Comp).person,
    'member',
  )
  equal((await together.read('.individual')).length, 1)
})

test('repeat children stay distinct even when they share the parent contact', async () => {
  await shared.apply(
    sign({
      phone: '+12695550142',
      children: [{ 'child-first': 'Bo', 'child-phone': '+12695550142' }],
    }),
  )
  let [link] = await shared.read('.relation')
  equal((link.relation as Comp).a, 'member')
  equal((link.relation as Comp).b == 'member', false)
  equal((await shared.read('.individual')).length, 2)
})

test('a partial guest resolves to a member when contact arrives and keeps its child', async () => {
  let answers = {
    first: 'Different',
    phone: '+12695550142',
    children: [{ 'child-first': 'Bo' }],
  }
  await partial.apply(sign(answers))
  let registration = (await partial.get(['signup']))[0].registration as Comp
  equal(registration.person, 'member')
  equal(registration.answers, answers)
  equal((await partial.read('.individual')).length, 2)
  equal((await partial.get([String(provisional)]))[0]?.individual, undefined)
  equal(((await partial.read('.relation'))[0].relation as Comp).a, 'member')
})

for (
  let [name, patch] of [
    ['directory field', { individual: { last: 'Editor supplied' } }],
    ['notes', { doc: { body: 'Editor supplied' } }],
  ] as const
) {
  let g = await setup([fixture])
  await g.apply(sign({ first: 'Different' }))
  let guest = String(((await g.get(['signup']))[0].registration as Comp).person)
  await g.apply([{ entity: { eid: guest }, ...patch }])
  test(`a provisional guest keeps editor-added ${name} when matched`, async () => {
    await g.apply(sign({ first: 'Different', phone: '+12695550142' }))
    let [kept] = await g.get([guest])
    equal(!!kept?.individual, true)
    for (let [comp, value] of Object.entries(patch)) {
      for (let [prop, field] of Object.entries(value)) {
        equal((kept[comp] as Comp)[prop], field)
      }
    }
    equal(((await g.get(['signup']))[0].registration as Comp).person, 'member')
  })
}

// Ann already has Bo, born 2020-03-04, in the directory.
let family = async (answers: object) => {
  let g = await setup([fixture, {
    entity: { eid: 'bo' },
    individual: { first: 'Bo', status: 'member', born: '2020-03-04' },
  }, {
    entity: { eid: 'ann-bo' },
    relation: { kind: 'parent', a: 'member', b: 'bo' },
  }])
  await g.apply(sign({ phone: '+12695550142', ...answers }))
  return {
    people: await g.read('.individual'),
    links: (await g.read('.relation')).map((l) => l.relation as Comp),
  }
}

for (
  let [name, child] of [
    ['by first name', { 'child-first': ' bo ' }],
    ['by name and birthday', {
      'child-first': 'Bo',
      'child-born': '2020-03-04',
    }],
  ] as const
) {
  test(`a member's listed child is found ${name}, not copied`, async () => {
    let { people, links } = await family({ children: [child] })
    equal(people.length, 2)
    equal(links, [{ kind: 'parent', a: 'member', b: 'bo' }])
  })
}

test('a child with another birthday is a new guest', async () => {
  let { people, links } = await family({
    children: [{ 'child-first': 'Bo', 'child-born': '2021-05-06' }],
  })
  equal(people.length, 3)
  equal(links.length, 2)
})

test("a member's child is found only as their child, and only once", async () => {
  let { people, links } = await family({
    partner: [{ 'partn-first': 'Bo' }],
    children: [{ 'child-first': 'Bo' }, { 'child-first': 'Bo' }],
  })
  equal(people.length, 4)
  equal(links.filter((l) => l.b == 'bo').length, 1)
})

test('a repeat records the relation its question names, or none', async () => {
  let { people, links } = await family({
    partner: [{ 'partn-first': 'Cy' }],
    others: [{ 'other-first': 'Di' }],
  })
  let cy = people.find((p) => (p.individual as Comp).first == 'Cy')!
  equal(people.length, 4)
  equal(links.sort((x, y) => String(x.kind).localeCompare(String(y.kind))), [
    { kind: 'parent', a: 'member', b: 'bo' },
    { kind: 'spouse', a: 'member', b: cy.entity.eid },
  ])
})

let rollbackStore = storage(durable(), vocab)
rollbackStore.install()
let rollback = graph({
  vocab,
  storage: rollbackStore,
  plugins: [directoryForms(vocab), {
    name: 'failed-commit',
    hooks: {
      commit: hook(['registration'], () => {
        throw new Error('failed commit')
      }),
    },
  }],
})
await rollback.apply(await phoned.read('.form|.question'))

test('a failed durable registration rolls back its directory changes', async () => {
  await throws(() => rollback.apply(sign({ first: 'New' })), 'failed commit')
  equal(await rollback.read('.individual|.registration|.relation'), [])
})
