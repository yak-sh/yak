import './testing.ts'
import { assertEquals } from '@std/assert'
import { bundle, entry } from './bundle.ts'

let slow = (name: string, fn: () => Promise<void>) =>
  Deno.test({ name, fn, ignore: !Deno.env.get('TASKS_SLOW') })

Deno.test('the entry imports what each plugin has, and nothing it lacks', () => {
  let source = entry('yak', ['@yaks/doc', { use: '@yaks/task' }, '@yaks/web'])
  let has = (s: string) => source.includes(s)
  assertEquals(has('doc/views.ts'), true)
  assertEquals(has('doc/vocab.ts'), true)
  assertEquals(has('task/views.ts'), true)
  assertEquals(has('web/views.ts'), false)
  assertEquals(has('boot({ name: "yak", views: [v0.views, v1.views]'), true)
})

slow('the entry bundles into one browser module', async () => {
  let js = await bundle(entry('yak', ['@yaks/doc', '@yaks/task']))
  assertEquals(js.includes('import '), false)
  assertEquals(js.length > 10_000, true)
})
