import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import {
  apiPath,
  door,
  hosting,
  localPath,
  pagePath,
  scopedStorage,
  storageKey,
} from './hosting.ts'
import { base, config } from './live.ts'
import { entityId, entityPath } from './url.ts'

let host = globalThis as { YAK_WEB?: ReturnType<typeof hosting> }
test('an app mount keeps page addresses and API transport apart', () => {
  let prior = host.YAK_WEB
  let old = { host: config.host, secure: config.secure }
  host.YAK_WEB = {
    page: '/notes/_web',
    api: '/notes/api',
    apply: '/notes/api/apply',
    owner: '/notes/_web/owner',
  }
  config.host = 'ada.yaks.app'
  config.secure = true
  try {
    assertEquals(base(), 'https://ada.yaks.app/notes/api')
    assertEquals(apiPath('/vocab'), '/notes/api/vocab')
    assertEquals(pagePath('/?q=hello'), '/notes/_web/?q=hello')
    assertEquals(localPath('/notes/_web/%23abcdef1234'), '/%23abcdef1234')
    assertEquals(entityPath('#abcdef1234'), '/notes/_web/%23abcdef1234')
    assertEquals(door('inspect'), false)
    assertEquals(door('freeze'), false)
    assertEquals(localPath('/other/_web/X-1'), '/other/_web/X-1')
  } finally {
    host.YAK_WEB = prior
    Object.assign(config, old)
  }
})

test('the box keeps its existing unmounted doors and public entity links', () => {
  assertEquals(apiPath('/vocab'), '/vocab')
  assertEquals(pagePath('/T-1'), '/T-1')
  assertEquals(entityId('https://tasks.yak.sh/T-1'), 'T-1')
  assertEquals(door('inspect'), true)
  assertEquals(door('freeze'), false)
})

test('app and person browser intent is isolated without moving box keys', () => {
  let prior = host.YAK_WEB
  let values = new Map<string, string>([['draft:edit', 'box draft']])
  let disk = {
    get length() {
      return values.size
    },
    key: (i: number) => [...values.keys()][i] ?? null,
    getItem: (k: string) => values.get(k) ?? null,
    setItem: (k: string, v: string) => {
      values.set(k, v)
    },
    removeItem: (k: string) => {
      values.delete(k)
    },
    clear: () => values.clear(),
  }
  try {
    host.YAK_WEB = { ...hosting(), storage: 'notes:ada' }
    let ada = scopedStorage(disk)
    assertEquals(ada.getItem('draft:edit'), null)
    ada.setItem('draft:edit', 'Ada draft')
    assertEquals(storageKey('tasks-outbox'), 'tasks-outbox:notes:ada')
    host.YAK_WEB = { ...hosting(), storage: 'notes:eli' }
    let eli = scopedStorage(disk)
    assertEquals(eli.length, 0)
    assertEquals(eli.getItem('draft:edit'), null)
    host.YAK_WEB = { ...hosting(), storage: 'other:ada' }
    assertEquals(scopedStorage(disk).getItem('draft:edit'), null)
    host.YAK_WEB = prior
    assertEquals(scopedStorage(disk).getItem('draft:edit'), 'box draft')
    assertEquals(storageKey('tasks-outbox'), 'tasks-outbox')
  } finally {
    host.YAK_WEB = prior
  }
})
