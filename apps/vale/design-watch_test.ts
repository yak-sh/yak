// Design readers receive changed designs once, even when a watch republishes
// the same rows while its connection or other graph components change.
import { assertEquals } from '@std/assert'
import { watchDesigns } from './design-watch.ts'

Deno.test('a design watch ignores equivalent rows and reports changed designs', () => {
  let a = { entity: { eid: 'a' }, theme_design: { name: 'Wood' } }
  let b = { entity: { eid: 'b' }, theme_design: { name: 'Marsh' } }
  let ready = false
  let value: ({
    entity: { eid: string }
    theme_design: { name: string }
    created?: { at: string }
  })[] = [a, b]
  let notify = () => {}
  let seen: string[][] = []
  watchDesigns(
    {
      get ready() {
        return ready
      },
      get value() {
        return value
      },
      subscribe: (fn) => notify = fn,
    },
    'theme_design',
    (rows) => seen.push(rows.map((r) => r.theme_design.name)),
  )
  notify()
  assertEquals(seen, [])
  ready = true
  notify()
  assertEquals(seen, [['Wood', 'Marsh']])
  value = [
    { ...b, entity: { eid: 'b' }, theme_design: { name: 'Marsh' } },
    { ...a, entity: { eid: 'a' }, theme_design: { name: 'Wood' } },
  ]
  notify()
  assertEquals(seen, [['Wood', 'Marsh']])
  value = [{ ...a, created: { at: 'later' } }, b]
  notify()
  assertEquals(seen, [['Wood', 'Marsh']])
  value = [{ ...a, theme_design: { name: 'Pine' } }, b]
  notify()
  assertEquals(seen, [['Wood', 'Marsh'], ['Pine', 'Marsh']])
})
