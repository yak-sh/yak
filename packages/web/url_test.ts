// Public entity links have one origin and speak the current path grammar.
import { assertEquals } from '@std/assert'
import { entityUrl, normalize } from './url.ts'

Deno.test('entity links use the public board and direct id path', () => {
  assertEquals(entityUrl('T-42'), 'https://tasks.yak.sh/T-42')
})

Deno.test('normalize gives one page one name', () => {
  let same = (a: string, b: string) => assertEquals(normalize(a), b)
  same('https://x.com', 'https://x.com/')
  same('  https://x.com/p  ', 'https://x.com/p')
  same('HTTPS://X.com/P', 'https://x.com/P') // host case, never the path
  same('https://x.com:443/p', 'https://x.com/p')
  same('http://x.com:80/p', 'http://x.com/p')
  same('https://x.com/p#section', 'https://x.com/p')
  same('https://x.com/p/', 'https://x.com/p')
  same('https://x.com/p//', 'https://x.com/p')
  same('https://x.com/?utm_source=n&utm_medium=e', 'https://x.com/')
  same('https://x.com/p?id=7&fbclid=abc', 'https://x.com/p?id=7')
  same('https://x.com/p?a=1&b=2', 'https://x.com/p?a=1&b=2') // order kept
  same('https://x.com/p?', 'https://x.com/p')
  same('https://user:pw@x.com/p', 'https://x.com/p')
})

Deno.test('normalize leaves alone what it does not understand', () => {
  // The same PropType carries repo.url — mangling a git remote is the bug.
  let same = (a: string) => assertEquals(normalize(a), a)
  same('git@github.com:jeffpeterson/tasks.git')
  same('mailto:jeff@yak.sh')
  same('~/code/tasks')
  same('')
})
