import { assertEquals, assertThrows } from '@std/assert'
import { fill, front, read } from './mod.ts'

Deno.test('read takes YAML', () => {
  assertEquals(read('doc:\n  title: Lemon cake\n'), {
    doc: { title: 'Lemon cake' },
  })
})

Deno.test('read takes JSON, which is YAML', () => {
  assertEquals(read('[{"doc": {"title": "Hi"}}]'), [{ doc: { title: 'Hi' } }])
})

Deno.test('a refusal names the file', () => {
  assertThrows(
    () => read('a:\n - b\n  c: d\n', 'seed/01-places.yml'),
    Error,
    'seed/01-places.yml is not YAML',
  )
})

// Whoever wrote a .json wrote JSON, and being told it is not YAML would send
// them looking in the wrong place.
Deno.test('a refusal calls a .json file JSON', () => {
  assertThrows(
    () => read('{oops', 'seed/02.json'),
    Error,
    'seed/02.json is not JSON',
  )
})

Deno.test('a passage takes what the code says for its holes', () => {
  assertEquals(
    fill('Publish {{app}} for {{who}}', { app: 'recipes', who: 'Ada' }),
    'Publish recipes for Ada',
  )
})

Deno.test('a hole nothing is said for is left standing', () => {
  assertEquals(fill('Publish {{app}}'), 'Publish {{app}}')
})

Deno.test('frontmatter is a bundle, and the body is what is under it', () => {
  let { meta, body } = front(
    '---\nentity: {eid: $store}\ndoc:\n  title: Hi\n---\n\nwords\n',
  )
  assertEquals(meta, { entity: { eid: '$store' }, doc: { title: 'Hi' } })
  assertEquals(body, '\nwords\n')
})

Deno.test('a file with no frontmatter is all body', () => {
  assertEquals(front('# Hi\n\nwords\n'), { meta: {}, body: '# Hi\n\nwords\n' })
})

// A rule under a heading is not a block that was never opened: only `---` on
// the very first line opens one.
Deno.test('a document that merely contains a rule is all body', () => {
  let text = '# Hi\n\n---\n\nwords\n'
  assertEquals(front(text), { meta: {}, body: text })
})

Deno.test('an empty block is a bundle with nothing in it', () => {
  assertEquals(front('---\n\n---\nwords\n'), { meta: {}, body: 'words\n' })
})

Deno.test('frontmatter that is not a bundle is refused by name', () => {
  assertThrows(
    () => front('---\n- one\n- two\n---\nwords\n', 'guide/store.md'),
    Error,
    'guide/store.md frontmatter is not a bundle',
  )
})
