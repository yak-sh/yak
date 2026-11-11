import { equal, test } from '@yaks/testing'
import { boundaries, carry, configured, exported } from './driver.ts'

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

test('a revision lacking a boundary module runs the driver copy, never a product one', () => {
  let tree: Record<string, string> = {
    'bench/run.ts':
      `import { a } from '@yaks/io/a'\nimport { g } from '@yaks/graph'\nimport { b } from "@yaks/io/b"`,
    'packages/io/a.ts': `import { b } from './b.ts'\nimport fs from 'node:fs'`,
    'packages/io/b.ts': `export { a } from './a.ts'`,
    'packages/graph/mod.ts': `import { a } from './inner.ts'`,
    'packages/graph/inner.ts': `import { a } from '@yaks/io/a'`,
  }
  let exports = {
    ...exported('packages/io', {
      name: '@yaks/io',
      exports: { './a': './a.ts', './b': './b.ts' },
    }),
    ...exported('packages/graph', { name: '@yaks/graph', exports: './mod.ts' }),
  }
  let found = boundaries([tree['bench/run.ts']], exports, (file) => tree[file])
  equal(found, {
    '@yaks/io/a': ['packages/io/a.ts', 'packages/io/b.ts'],
    '@yaks/io/b': ['packages/io/b.ts', 'packages/io/a.ts'],
  })
  equal(carry(found, new Set(['@yaks/io/b', '@yaks/graph'])), {
    '@yaks/io/a': './.carried/packages/io/a.ts',
  })
  equal(boundaries([`import '@yaks/io/a'`], exports, () => undefined), {})
})

test('npm workspace imports name the archived product before shared node_modules', () => {
  let modules = exported('packages/git', {
    name: '@yaks/git',
    exports: { '.': './mod.ts', './land': './land.ts' },
  })
  let driver = { imports: { '@yaks/git/land': './current/land.ts' } }
  let config = configured({}, driver, modules, {
    '@yaks/io': './.carried/io.ts',
  })
  equal(config.imports, {
    '@yaks/git': './packages/git/mod.ts',
    '@yaks/git/land': './packages/git/land.ts',
    '@yaks/io': './.carried/io.ts',
  })
})
