import { test } from '@yaks/testing'
import { compose } from './host.ts'

let host = await compose({
  db: ':memory:',
  plugins: [
    '@yaks/kernel',
    '@yaks/provenance',
    '@yaks/process',
    '@yaks/tools',
    '@yaks/effects',
  ],
}, ['graph'])
await host.close()

test('a forced ending arriving after graceful close is already complete', async () => {
  await host.end(host.me, 'interrupted: frontend close deadline expired')
})
