// Discovery reads declarations; runtime options belong to invocation.
import { equal, test } from '@yaks/testing'
import { declarations } from './declarations.ts'

let expected = await declarations({ plugins: ['@yaks/doc'] }, true)

test('command discovery leaves runtime option accessors unread', async () => {
  let said = await declarations({
    plugins: [{
      use: '@yaks/doc',
      with: {
        get credential() {
          throw new Error('only a running factory may read this option')
        },
      },
    }],
  }, true)
  equal(said.tools, expected.tools)
  equal(said.vocabs, expected.vocabs)
})
