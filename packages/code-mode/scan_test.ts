import { equal, test } from '@yaks/testing'
import { declared } from './scan.ts'

let names = (body: string) => declared(body).names.sort()

test('a cell keeps the names its own top level binds', () => {
  equal(names('let a = 1\nconst b = 2, c = [3]\nvar d'), ['a', 'b', 'c', 'd'])
  equal(
    names(
      'const { e, f: g, h = { i: 1 }, ...j } = o; let [k, , l = m(n, o), ...p] = q',
    ),
    ['e', 'g', 'h', 'j', 'k', 'l', 'p'],
  )
  equal(names('if (x) { let inner = 1 }\nfor (let i = 0; i < 2; i++) {}'), [])
  equal(
    names('let f = () => { let nested = 1; return nested }\nlet after = 2'),
    [
      'after',
      'f',
    ],
  )
  equal(
    names(
      'let s = "let no = 1", t = `${`let x`} ${{ y: 1 }.y}`, r = /let z/g\nlet u = a / b / c',
    ),
    ['r', 's', 't', 'u'],
  )
  equal(names('o.let = 1\nreturn { let: 2 }'), [])
  equal(names('n = f(n)\nlet after = 1'), ['after'])
})

test('a cell keeps its function and class declarations as source', () => {
  let src =
    'async function load({ a }) {\n  return a\n}\nclass Box extends Base { get v() { return 1 } }\nlet f = function g() {}\nreturn load(f)'
  equal(declared(src), {
    names: ['f'],
    declarations: {
      load: 'async function load({ a }) {\n  return a\n}',
      Box: 'class Box extends Base { get v() { return 1 } }',
    },
  })
})
