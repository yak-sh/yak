import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import type { Directory } from './directory.ts'
import { app, space } from './directory-fixture.ts'
import { linked } from './preview-route.ts'
import { shotOf } from './gallery.ts'
import { installAt } from '@yaks/platform/routes'

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

test('an install link names the app a copy is of, free unless it is sold', async () => {
  let copyOf = async (over: Parameters<typeof app>[0], back = false) => {
    let offered = { app: app(over), space: space() }
    let dir = {
      offered: (name: string) =>
        Promise.resolve(name == 'recipes' ? offered : null),
    } as Directory
    return (await linked({}, installAt('recipes', back), dir))?.copy
  }
  let shown = shotOf(space(), app())
  assertEquals(await copyOf({}), {
    title: 'Recipe box',
    image: shown,
    free: true,
  })
  // Pressed for on a listing, the copy is made as they come back (install.ts).
  assertEquals((await copyOf({}, true))?.pressed, true)
  assertEquals(await copyOf({ access: 'private' }), {
    title: 'Recipe box',
    image: undefined,
    free: true,
  })
  assertEquals(
    (await copyOf({
      published: { ...app().published!, price: { cents: 500, interval: null } },
    }))?.free,
    false,
  )
  assertEquals(
    await copyOf({ trashed: { at: '2026-09-02', by: 'ada' } }),
    undefined,
  )
})
