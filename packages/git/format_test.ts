import { equal, test } from '@yaks/testing'
import { formatConfig, formatting } from './format.ts'

test('explicit formatting paths retain global and formatter exclusions', () => {
  equal(
    formatting(['./source.ts', './pnpm-lock.yaml', './generated/report.md'], {
      exclude: ['generated/**'],
      fmt: { exclude: ['pnpm-lock.yaml', 'generated/**'] },
    }),
    [
      'fmt',
      '--permit-no-files',
      '--ignore=generated/**',
      '--ignore=pnpm-lock.yaml',
      './source.ts',
      './pnpm-lock.yaml',
      './generated/report.md',
    ],
  )
})

test('a checkout without exclusions delegates its filenames to Deno unchanged', () => {
  equal(
    formatting(['./page with spaces.html', './image.png', './-script.ts'], {}),
    [
      'fmt',
      '--permit-no-files',
      './page with spaces.html',
      './image.png',
      './-script.ts',
    ],
  )
})

test('formatting reads JSONC exclusions without treating comments as paths', async () => {
  let config = await formatConfig('/source', (path) =>
    Promise.resolve(
      path.endsWith('.jsonc')
        ? `{
      // generated files retain their writer's formatting
      "exclude": ["generated/**"],
      "fmt": {"exclude": ["pnpm-lock.yaml",]},
    }`
        : undefined,
    ))
  equal(formatting(['./pnpm-lock.yaml', './code.ts'], config), [
    'fmt',
    '--permit-no-files',
    '--ignore=generated/**',
    '--ignore=pnpm-lock.yaml',
    './pnpm-lock.yaml',
    './code.ts',
  ])
})

test('a checkout without a Deno config has no formatting config', async () => {
  equal(
    await formatConfig('/source', () => Promise.resolve(undefined)),
    undefined,
  )
})

test('an empty Deno config formats with Deno defaults', async () => {
  let config = await formatConfig('/source', () => Promise.resolve('{}'))
  equal(formatting(['./code.ts'], config), [
    'fmt',
    '--permit-no-files',
    './code.ts',
  ])
})
