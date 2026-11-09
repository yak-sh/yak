import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import type { Directory } from './directory.ts'
import { app, space } from './directory-fixture.ts'
import { linked } from './preview-route.ts'
import { shotOf } from './gallery.ts'

test('private route previews never ask the directory for names or content', async () => {
  let dir = {} as Directory
  for (
    let path of [
      '/manage/unknown/operator/new',
      '/manage/unknown/connections',
      'https://private.yaks.app/app/',
    ]
  ) {
    assertEquals(
      (await linked({}, path, dir))?.title.includes('unknown'),
      false,
    )
  }
})

test('install links use only a current public offer and its allowed picture', async () => {
  for (let access of ['public', 'private'] as const) {
    let offered = { app: app({ access }), space: space() }
    let dir = {
      offered: (name: string) =>
        Promise.resolve(name == 'recipes' ? offered : null),
    } as Directory
    let preview = await linked({}, '/install?name=recipes', dir)
    assertEquals(preview?.title, 'Recipe box · yaks.app')
    assertEquals(preview?.description, offered.app.published?.about)
    assertEquals(
      preview?.image,
      access == 'public' ? shotOf(offered.space, offered.app) : undefined,
    )
    assertEquals(
      (await linked({}, '/install?name=unknown', dir))?.title,
      'Make your own copy · yaks.app',
    )
  }
})
