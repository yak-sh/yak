// The generated loader returns a facet module or an absent facet without IO.
import { equal, test } from '@yaks/testing'
import * as doc from '@yaks/doc/vocab'
import { load } from './load.ts'

test('store loader resolves exported vocabulary and absent facets', async () => {
  equal(await load('@yaks/doc', 'vocab'), doc)
  equal(await load('@yaks/doc', 'effects'), null)
  equal(await load('unconfigured', 'vocab'), null)
  equal(await load('@yaks/mail', 'service'), null)
})
