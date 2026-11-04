import { test } from '@yaks/testing'
import { assertEquals, assertNotEquals } from '@std/assert'
import { type Info, project } from './tsconfig.ts'

test('one source project resolves two directly imported versions of an npm package', () => {
  let versions = ['1', '2']
  let info: Info = {
    redirects: {},
    modules: versions.flatMap((v) => [
      {
        specifier: `file:///app/${v}.ts`,
        dependencies: [{
          specifier: `lexer${v}/js`,
          code: { specifier: `npm:/lexer@${v}/js` },
        }],
      },
      { specifier: `npm:/lexer@${v}/js`, npmPackage: `lexer@${v}` },
    ]),
    npmPackages: Object.fromEntries(versions.map((v) => [
      `lexer@${v}`,
      { name: 'lexer', dependencies: [], localPath: `/cache/lexer/${v}` },
    ])),
  }
  let p = project(
    info,
    '/app',
    '/app/.types',
    ['1.ts', '2.ts'],
    Object.fromEntries(versions.map((v) => [
      `lexer@${v}`,
      { exports: { './js': { types: `./types/${v}.d.ts` } } },
    ])),
  )
  let paths = p.config.compilerOptions.paths as Record<string, string[]>
  let resolved = versions.map((v) => {
    let [path] = paths[`lexer${v}/js`]
    let home = path.replace(/^\.\//, '').replace(`/types/${v}.d.ts`, '')
    return `${{ ...p.links, ...p.spread }[home]}/types/${v}.d.ts`
  })
  assertEquals(resolved, [
    '/cache/lexer/1/types/1.d.ts',
    '/cache/lexer/2/types/2.d.ts',
  ])
  assertNotEquals(paths['lexer1/js'], paths['lexer2/js'])
})
