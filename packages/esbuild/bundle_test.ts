import { equal, test } from '@yaks/testing'
import { bundle } from './bundle.ts'

let choice = (browser: boolean) => {
  let files: Record<string, string> = {
    'node_modules/choice/package.json': JSON.stringify({
      exports: {
        '.': {
          node: { import: './node.js', require: './node.cjs' },
          ...browser
            ? { browser: { import: './browser.js', require: './browser.cjs' } }
            : {},
          import: './portable.js',
          require: './portable.cjs',
        },
      },
    }),
  }
  for (let target of ['node', 'browser', 'portable']) {
    files['node_modules/choice/' + target + '.js'] =
      `export let value = '${target} import'`
    files['node_modules/choice/' + target + '.cjs'] =
      `exports.value = '${target} require'`
  }
  return files
}

for (let browser of [false, true]) {
  for (let node of [false, true]) {
    for (let require of [false, true]) {
      let target = node ? 'node' : browser ? 'browser' : 'portable'
      let kind = require ? 'require' : 'import'
      test(`conditional exports select ${target} ${kind} with browser branch ${browser}`, async () => {
        let files = {
          ...choice(browser),
          'main.js': require
            ? "export let value = require('choice').value"
            : "export { value } from 'choice'",
        }
        let result = await bundle(
          { read: (path) => files[path as keyof typeof files] ?? null },
          'main.js',
          { node },
        )
        let built = await import(
          'data:text/javascript,' + encodeURIComponent(result.code)
        )
        equal(built.value, target + ' ' + kind)
      })
    }
  }
}
