import { equal, test } from '@yaks/testing'
import { gameStarter, gameViews, starterSources } from './starter.ts'

let here = new URL('./starter/', import.meta.url)
let sources = Object.fromEntries(
  await Promise.all(starterSources.map(async (path) => [
    path,
    path.endsWith('.png') ? '' : await Deno.readTextFile(new URL(path, here)),
  ])),
)

test('every starter variant carries each file its modules import, and each package', () => {
  for (let view of gameViews) {
    for (let multiplayer of [false, true]) {
      let files = gameStarter({ view, multiplayer }, sources)
      let paths = new Set(files.map((f) => f.path))
      let { dependencies } = JSON.parse(
        files.find((f) => f.path === 'package.json')!.content!,
      )
      let missing = files.flatMap(({ path, content = '' }) =>
        path.endsWith('.ts')
          ? [...content.matchAll(/from '([^']+)'/g)].map(([, spec]) => spec)
            .filter((spec) =>
              spec.startsWith('./')
                ? !paths.has(spec.slice(2))
                : !(spec.split('/').slice(0, spec.startsWith('@') ? 2 : 1)
                  .join('/') in dependencies)
            ).map((spec) => `${path} → ${spec}`)
          : []
      )
      equal([view, multiplayer, missing], [view, multiplayer, []])
    }
  }
})
