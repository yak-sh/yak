import { equal, test } from '@yaks/testing'
import { configured } from './driver.ts'

test('a historical product keeps its dependencies while current fixtures gain theirs', () => {
  let old = {
    imports: { product: 'product-v1', shared: 'shared-v1' },
    workspace: ['./packages/product'],
    compilerOptions: { strict: true },
  }
  let current = {
    imports: {
      product: 'product-v2',
      shared: 'shared-v2',
      fixture: 'fixture-v2',
    },
    workspace: ['./packages/new-product'],
  }
  let config = configured(old, current)
  equal(config.imports, {
    product: 'product-v1',
    shared: 'shared-v1',
    fixture: 'fixture-v2',
  })
  equal(config.workspace, ['./packages/product', './packages/benchmark'])
  equal(config.compilerOptions, { strict: true })
  equal(old.workspace, ['./packages/product'])
  equal(configured(config, current), config)
})
