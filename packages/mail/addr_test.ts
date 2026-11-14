import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { address, at, canon, local, parts, sendable } from './addr.ts'

let mine = canon('books.example')

test('parts: one @, or nothing', () => {
  assertEquals(parts('ana@books.example'), ['ana', 'books.example'])
  assertEquals(parts('  ana@books.example  '), ['ana', 'books.example'])
  assertEquals(parts('ana'), null)
  assertEquals(parts('ana@books.example@'), null)
  assertEquals(parts('@books.example'), null)
})

test('sendable: an address a provider takes a letter for', () => {
  let yes = ['ana@books.example', 'a.b+c@x.co', "o'neil@a-b.example"]
  let no = [
    'ana',
    'ana@books',
    'ana@@books.example',
    'ana@books..example',
    '.ana@books.example',
    'a..b@books.example',
    'ana@-books.example',
    'Ana <ana@books.example>',
    'ana@books.example,',
    'añа@books.example',
    ' ana@books.example',
  ]
  for (let a of yes) assertEquals(sendable(a), true, a)
  for (let a of no) assertEquals(sendable(a), false, a)
})

test('local: the domain is case-blind, the local part is kept as written', () => {
  assertEquals(local('books.example')('Ana@Books.Example'), 'Ana')
  assertEquals(local('books.example')('ana@elsewhere.com'), null)
  assertEquals(at('books.example')('ana@books.example'), true)
  assertEquals(at('books.example')('ana@elsewhere.com'), false)
  assertEquals(address('ana', 'books.example'), 'ana@books.example')
})

// The corpus src/mail_test.ts holds the fleet's canon() to, transposed to a
// domain of this package's own: same five cases, same five answers.
test('canon: my domain sheds underscores and case; every other passes', () => {
  assertEquals(mine('book_club@books.example'), 'bookclub@books.example')
  assertEquals(mine('Ops@Books.Example'), 'ops@books.example')
  assertEquals(mine('under_score@gmail.com'), 'under_score@gmail.com')
  assertEquals(
    mine('under_score@sub.books.example'),
    'under_score@sub.books.example',
  )
  assertEquals(mine('under_score@books.example@'), 'under_score@books.example@')
})

test('canon: idempotent, and blind to how the domain was configured', () => {
  assertEquals(mine(mine('Book_Club@Books.Example')), 'bookclub@books.example')
  assertEquals(
    canon(' Books.Example ')('A_B@books.example'),
    'ab@books.example',
  )
})
