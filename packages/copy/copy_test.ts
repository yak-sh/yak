import { equal, suite, throws } from '@yaks/testing'
import { fill, keys, marks, merge, parse, read, set, slots } from './mod.ts'

let file = `{
  "cost": {
    "note": "A space is your address, like %{yours}, with its apps, their data and the people you invite.",
    "limits": "Tax is included. Going over a limit never deletes your apps or data. %{plans}.",
    "plans": "Compare plans and limits"
  },
  "hero.title": "Build, host and share web apps"
}
`
let copy = parse(file)

suite('a copy file', ({ it }) => {
  it('reads a nested object as dotted keys, and a dotted key as itself', () => {
    equal(read(copy, 'cost.plans'), 'Compare plans and limits')
    equal(read(copy, 'hero.title'), 'Build, host and share web apps')
    equal(read(copy, 'cost'), undefined)
    equal(read(copy, 'cost.missing'), undefined)
  })

  it('lists its keys in its order', () =>
    equal(keys(copy), ['cost.note', 'cost.limits', 'cost.plans', 'hero.title']))

  it('is empty when blank', () => equal(parse(' \n'), {}))

  it('names itself when it is not JSON', () =>
    throws(
      () => parse('{oops', 'apps/notes/copy.json'),
      'apps/notes/copy.json is not JSON',
    ))

  it('names the key whose value is not a snippet', () =>
    throws(() => parse('{"hero": {"count": 3}}'), 'hero.count'))
})

suite('a slot', ({ it }) => {
  let yours = { span: 'you.yaks.app' }
  let link = { a: '/pricing' }

  it('takes a part inside a sentence', () =>
    equal(fill(read(copy, 'cost.note')!, { yours }), [
      'A space is your address, like ',
      yours,
      ', with its apps, their data and the people you invite.',
    ]))

  it('takes a link ending one', () =>
    equal(fill(read(copy, 'cost.limits')!, { plans: link }), [
      'Tax is included. Going over a limit never deletes your apps or data. ',
      link,
      '.',
    ]))

  it('given nothing stays named', () =>
    equal(fill('like %{yours}.'), ['like %{yours}.']))

  it('is written as text when doubled', () =>
    equal(fill('%%{yours} is %{yours}', { yours }), ['%{yours} is ', yours]))

  it('leaves a lone percent alone', () => equal(fill('50% off'), ['50% off']))

  it('is listed by name', () =>
    equal(slots('%{a}, %%{b} and %{c}'), ['a', 'c']))
})

suite('setting keys', ({ it }) => {
  let lines = (text: string) => text.split('\n')

  it('keeps a key in its place', () => {
    let out = set(file, { 'cost.plans': 'See every plan' })
    equal(read(parse(out), 'cost.plans'), 'See every plan')
    equal(keys(parse(out)), keys(copy))
    equal(lines(out).length, lines(file).length)
  })

  it('adds a key to the object it leads into', () =>
    equal(
      keys(parse(set(file, { 'cost.free': 'Your first space is free.' }))),
      [
        'cost.note',
        'cost.limits',
        'cost.plans',
        'cost.free',
        'hero.title',
      ],
    ))

  it('adds a key nothing names at the end, as written', () =>
    equal(
      set('{}', { 'hero.kicker': 'yaks.app' }),
      '{\n  "hero.kicker": "yaks.app"\n}\n',
    ))

  it('writes one snippet per line', () =>
    equal(
      set('', { 'a': 'one\ntwo', 'b.c': 'three' }),
      '{\n  "a": "one\\ntwo",\n  "b.c": "three"\n}\n',
    ))

  it('keeps the file’s indentation', () =>
    equal(set('{\n\t"a": "x"\n}\n', { a: 'y' }), '{\n\t"a": "y"\n}\n'))
})

suite('an element’s marks', ({ it }) => {
  it('name its text, its slot and its attributes’ keys', () =>
    equal(
      marks({
        'data-copy': 'cost.plans',
        'data-copy-slot': 'plans',
        'data-copy-aria-label': 'cost.plans.label',
        href: '/pricing',
      }),
      {
        text: 'cost.plans',
        slot: 'plans',
        attrs: { 'aria-label': 'cost.plans.label' },
      },
    ))

  it('read from a list of attributes, as a DOM element has', () =>
    equal(marks([{ name: 'data-copy-alt', value: 'hero.image' }]), {
      attrs: { alt: 'hero.image' },
    }))
})

suite('a merge', ({ it }) => {
  let text = (copy: Record<string, string>) =>
    JSON.stringify(copy, null, 2) + '\n'
  let base = { a: 'one', b: 'two', c: 'three' }
  // What merging `theirs` over `ours` from `base` leaves, as a value.
  let merged = (
    ours: Record<string, string>,
    theirs: Record<string, string>,
    from: Record<string, string> | null = base,
  ) => parse(merge(text(ours), text(theirs), from ? text(from) : ''))

  it('keeps an edit made only on our side', () =>
    equal(merged({ ...base, a: 'uno' }, base), { ...base, a: 'uno' }))

  it('takes an edit made only on theirs', () =>
    equal(merged(base, { ...base, b: 'dos' }), { ...base, b: 'dos' }))

  it('takes theirs where both edited a key', () =>
    equal(merged({ ...base, b: 'zwei' }, { ...base, b: 'dos' }), {
      ...base,
      b: 'dos',
    }))

  it('keeps a key only ours added, and one only theirs added', () =>
    equal(merged({ ...base, d: 'four' }, { ...base, e: 'five' }), {
      ...base,
      d: 'four',
      e: 'five',
    }))

  it('leaves out a key we removed that theirs left alone', () =>
    equal(merged({ a: 'one', b: 'two' }, base), { a: 'one', b: 'two' }))

  it('keeps a key we removed that theirs edited', () =>
    equal(merged({ a: 'one', b: 'two' }, { ...base, c: 'tres' }), {
      a: 'one',
      b: 'two',
      c: 'tres',
    }))

  it('takes every key of theirs without a base', () =>
    equal(merged({ a: 'uno', d: 'four' }, { a: 'one', b: 'two' }, null), {
      a: 'one',
      d: 'four',
      b: 'two',
    }))

  it('answers our text itself when theirs changed nothing', () => {
    let ours = '{\n    "a": "uno"\n}\n'
    equal(merge(ours, text(base), text(base)), ours)
  })
})
