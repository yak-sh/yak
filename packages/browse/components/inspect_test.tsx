import { test, until } from '@yaks/testing'
import '../testing.ts'
import { h } from 'preact'
import { type Bundle, Disclosure, disclosureAt } from '@yaks/ux'
import { inspectIo } from './inspect.tsx'
import { mount } from './mount.ts'

test("a view's own page state, set through the inspector's io, redraws it", async () => {
  let eid = disclosureAt('inspect-test')
  let View = () =>
    h(Disclosure, {
      e: inspectIo.state(eid) ?? { entity: { eid } },
      onChange: (b: Bundle) => inspectIo.set([b]),
      summary: 'more',
    }, 'the rest')
  let mounted = mount(h(View, {}))
  try {
    ;(mounted.root.querySelector('button') as HTMLElement).click()
    await until(() => mounted.root.textContent!.includes('the rest'), {
      label: 'opened',
    })
  } finally {
    mounted.free()
  }
})
