// Progress, conditional repeat answers and availability through the pure API.

import { equal, test } from '@yaks/testing'
import {
  type Answers,
  type Form,
  missing,
  next,
  open,
  type Question,
} from './mod.ts'

let question = (
  eid: string,
  props: Partial<Question['question']> = {},
): Question => ({
  entity: { eid },
  question: { form: 'form', label: eid, kind: 'line', ...props },
})
let form = (...questions: Question[]): Form => ({ form: {}, questions })
let paths = (f: Form, answers: Answers) =>
  missing(f, answers).map((q) => q.path)

test('required questions precede optional ones, with stable order and skips', () => {
  let f = form(
    question('optional', { order: -1 }),
    question('b', { required: true }),
    question('a', { required: true }),
  )
  equal(next(f, {})?.path, ['a'])
  equal(paths(f, {}), [['a'], ['b']])
  equal(next(f, { a: false, b: 0 })?.path, ['optional'])
  equal(next(f, { a: false, b: 0, optional: null }), undefined)
  equal(paths(f, { a: '   ', b: [] }), [['a'], ['b']])
  equal(paths(f, { a: null, b: 'yes' }), [['a']])
})

test('conditions ignore hidden questions and their stale answers', () => {
  let f = form(
    question('first', { kind: 'check' }),
    question('second', { when: { question: 'first', is: true } }),
    question('third', {
      required: true,
      when: { question: 'second', is: ['yes'] },
    }),
  )
  equal(paths(f, { first: false, second: ['yes'] }), [])
  equal(paths(f, { first: true, second: ['yes'] }), [['third']])
  equal(paths(f, { first: true, second: ['no'] }), [])
})

test('required children are owed for every populated repeat entry', () => {
  let f = form(
    question('children', { kind: 'repeat' }),
    question('name', { within: 'children', required: true }),
    question('notes', { within: 'children' }),
  )
  equal(paths(f, {}), [])
  equal(paths(f, { children: null }), [])
  equal(next(f, { children: [] }), undefined)
  equal(paths(f, { children: [{ name: 'Sam' }, {}] }), [[
    'children',
    1,
    'name',
  ]])
  equal(next(f, { children: [{}, {}] })?.path, ['children', 0, 'name'])
  equal(next(f, { children: [{ name: 'Sam' }, { name: 'Jo' }] })?.path, [
    'children',
    0,
    'notes',
  ])
})

test('required repeats need entries and malformed repeat answers stay owed', () => {
  let f = form(
    question('children', { kind: 'repeat', required: true }),
    question('name', { within: 'children', required: true }),
  )
  for (let children of [undefined, null, [], 'yes', {}]) {
    equal(paths(f, { children }), [['children']])
  }
  equal(paths(f, { children: [null] }), [['children', 0, 'name']])
  equal(paths(f, { children: [{ name: 'Sam' }] }), [])
})

test('conditions use repeat scopes, and hidden ancestors suppress their children', () => {
  let f = form(
    question('include', { kind: 'check' }),
    question('children', {
      kind: 'repeat',
      when: { question: 'include', is: true },
    }),
    question('allergy', { within: 'children', kind: 'check' }),
    question('medicine', {
      within: 'children',
      required: true,
      when: { question: 'allergy', is: true },
    }),
    question('details', {
      within: 'children',
      kind: 'repeat',
      when: { question: 'include', is: true },
    }),
    question('dose', { within: 'details', required: true }),
  )
  let children = [{ allergy: false }, { allergy: true, details: [{}] }]
  equal(paths(f, { include: false, allergy: true, children }), [])
  equal(paths(f, { include: true, allergy: true, children }), [
    ['children', 1, 'details', 0, 'dose'],
    ['children', 1, 'medicine'],
  ])
})

test('open uses inclusive opening, exclusive closing and supplied capacity', () => {
  let at = Date.parse('2026-11-08T12:00:00Z')
  let f = {
    form: {
      opens: new Date(at).toISOString(),
      closes: new Date(at + 1).toISOString(),
      capacity: 2,
    },
  }
  equal(open(f, at - 1, 0), false)
  equal(open(f, at, 1), true)
  equal(open(f, at + 1, 1), false)
  equal(open(f, at, 2), false)
  equal(open({ form: {} }, at, 1000), true)
  equal(open({ form: { capacity: 0 } }, at, 0), false)
  equal(open({ form: { opens: 'invalid' } }, at, 0), false)
  equal(open({ form: { closes: 'invalid' } }, at, 0), false)
  equal(open({ form: {} }, NaN, 0), false)
})
