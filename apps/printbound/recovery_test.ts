import { browserDrafts } from '@yaks/draft/browser'
import type { Stash } from '@yaks/draft'
import { equal, test } from '@yaks/testing'
import { parseHTML } from 'linkedom'

let sources = await Promise.all(
  ['printbound', 'crayonbloom'].map(async (app) => ({
    app,
    text: await Deno.readTextFile(
      new URL(`../${app}/recovery.js`, import.meta.url),
    ),
  })),
)
for (let { app, text } of sources) {
  test(`${app} restores an intentionally empty offline field without reseeding old text`, async () => {
    let { document } = parseHTML('<input name="title" value="Removed title">')
    Object.defineProperty(document, 'baseURI', {
      value: 'https://fixture.test/',
    })
    let values = new Map([
      [
        'yaks:drafts:https://fixture.test/api/|person:draft:book:one:title',
        JSON.stringify({ text: '', over: 'Removed title', rev: 1 }),
      ],
    ])
    let storage: Stash = {
      get length() {
        return values.size
      },
      key: (i) => [...values.keys()][i] ?? null,
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => {
        values.set(key, value)
      },
      removeItem: (key) => {
        values.delete(key)
      },
    }
    let make = new Function(
      'browserDrafts',
      'document',
      text.replace(/^import[^\n]+\n/m, '').replace(
        'export let recovery',
        'let recovery',
      ) +
        '\nreturn recovery',
    )(
      (
        client: Parameters<typeof browserDrafts>[0],
        scope: string,
        opts: object,
      ) => browserDrafts(client, scope, { ...opts, stash: storage }),
      document,
    )
    let recovery = await make(
      (name: string, value?: unknown) =>
        name === 'drafts' && !value
          ? Promise.resolve({ principal: 'person', drafts: [] })
          : new Promise(() => {}),
      (error: unknown) => {
        throw error
      },
    )
    try {
      let input = document.querySelector('input')!
      recovery.field(input, 'book:one:title')
      equal(input.value, '')
    } finally {
      recovery.close()
    }
  })
}
