import { equal, test, throws } from '@yaks/testing'
import { assertRejects } from '@std/assert'
import { content, NAMES, suite } from './platform-waits.ts'

test('platform wait registration needs no probe or hand arguments', () => {
  let definition = suite()
  equal(definition.name, 'platform-waits')
  equal(definition.benches.map((b) => b.name), [...NAMES])
  equal(definition.benches.every((b) => b.unit == 'ms'), true)
  throws(() => suite(['a-deployed-account']))
})

test('platform HTML waits consume content, not just successful headers', async () => {
  let sent = false
  let body = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('<h1>'))
      queueMicrotask(() => {
        sent = true
        controller.enqueue(new TextEncoder().encode('The saved app</h1>'))
        controller.close()
      })
    },
  })
  equal(
    await content(new Response(body), 'The saved app'),
    '<h1>The saved app</h1>',
  )
  equal(sent, true)
})

test('an error or unrelated page cannot bank a fast platform wait', async () => {
  await assertRejects(() =>
    content(new Response('The app', { status: 503 }), 'The app')
  )
  await assertRejects(() => content(new Response('Sign in'), 'The app'))
})
