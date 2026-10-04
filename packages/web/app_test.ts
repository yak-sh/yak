// The browser door discovers configured app facets without knowing an app.
import { equal, test, throws } from '@yaks/testing'
import { type Application, application } from './app.ts'
let one: Application = {
  entry: new URL('file:///app/main.ts'),
  mount: new URL('file:///app/mount.ts'),
}
test('configured web facets select one app, skipping plugins without it', async () => {
  let asked: string[] = []
  let load = (p: string) => {
    asked.push(p)
    return Promise.resolve(p == 'app' ? { app: one } : null)
  }
  equal(await application(['data', 'app'], undefined, load), one)
  equal(asked, ['data', 'app'])
})
test('explicit application selector resolves competing facets', async () => {
  let load = (_p: string) => Promise.resolve({ app: one })
  equal(await application(['a', 'b'], 'b', load), one)
  await throws(() => application(['a', 'b'], undefined, load), /one configured/)
  await throws(() => application(['a'], 'missing', load), /found 0/)
})
