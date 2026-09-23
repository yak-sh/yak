import { assert, assertEquals } from '@std/assert'
import { canon, fetchable, pageEid } from './url.ts'

let same = (a: string, b: string) => assertEquals(canon(a), b)

Deno.test('one address, canonically spelled', () => {
  // the spot inside a page is not the page
  same('https://a.com/x#top', 'https://a.com/x')
  // a trailing slash is a server's habit; the root's slash is the root
  same('https://a.com/x/', 'https://a.com/x')
  same('https://a.com/', 'https://a.com/')
  same('https://a.com', 'https://a.com/')
  // the trip, not the destination
  same('https://a.com/x?utm_source=n&q=1', 'https://a.com/x?q=1')
  same('https://a.com/x?fbclid=9', 'https://a.com/x')
  // credentials are never part of a page's name
  same('https://u:p@a.com/x', 'https://a.com/x')
  // the host is case-insensitive and the path is not
  same('HTTPS://A.com/X', 'https://a.com/X')
  // query order is the site's, never ours
  same('https://a.com/x?b=2&a=1', 'https://a.com/x?b=2&a=1')
})

Deno.test('an address this package does not canonicalize is left alone', () => {
  same('file:///tmp/note.html', 'file:///tmp/note.html')
  same('git@host:owner/repo.git', 'git@host:owner/repo.git')
  same('  https://a.com/x  ', 'https://a.com/x')
  assert(fetchable('http://a.com/x'))
  assert(!fetchable('file:///x'))
})

Deno.test('canonicalizing is idempotent', () => {
  for (
    let raw of ['https://a.com/x/?utm_source=n#f', 'file:///x', 'nonsense']
  ) {
    assertEquals(canon(canon(raw)), canon(raw))
  }
})

Deno.test('the address names the entity', () => {
  // two spellings of one page are one entity, and a uuid either way
  assertEquals(pageEid('https://a.com/x/'), pageEid('HTTPS://a.com/x?utm_a=1'))
  assert(
    /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(
      pageEid('https://a.com/x'),
    ),
  )
  // a different page is a different entity
  assert(pageEid('https://a.com/x') != pageEid('https://a.com/y'))
})
