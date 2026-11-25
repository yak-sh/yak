// An app's splash set: drawn once from its icon and background, recorded,
// and its older sets swept; and the background read off its sheets.
import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import {
  ensureSplash,
  palette,
  splashes,
  splashKey,
  splashPrefix,
} from './splash.ts'

let space = { store: 'ada' }
let ICON = new Uint8Array([1, 2, 3])
let WHITE = { light: '#ffffff', dark: null }

let run = async (
  kept: string[],
  splash: { key: string; dark: boolean } | null = null,
) => {
  let objects = new Set(kept)
  let drawn: string[] = [], recorded: unknown[] = []
  let said = await ensureSplash({
    live: () =>
      Promise.resolve({ space, app: { eid: 'e', slug: 'box', splash } }),
    inputs: () => Promise.resolve({ icon: ICON, palette: WHITE }),
    has: (k) => Promise.resolve(objects.has(k)),
    draw: (svg) => (drawn.push(svg), Promise.resolve(new Uint8Array())),
    put: (k) => (objects.add(k), Promise.resolve()),
    record: (d) => (recorded.push(d), Promise.resolve()),
    list: (p) => Promise.resolve([...objects].filter((k) => k.startsWith(p))),
    delete: (ks) => (ks.forEach((k) => objects.delete(k)), Promise.resolve()),
  })
  return { objects: [...objects], drawn: drawn.length, recorded, said }
}

let key = await splashKey(ICON, WHITE)
let sets = splashPrefix(space, { eid: 'e', slug: 'box' })

test('a new set is drawn whole, recorded, and the older set swept', async () => {
  let { objects, drawn, recorded, said } = await run([`${sets}0000/1x1.png`])
  assertEquals(said, 'drawn')
  assertEquals(drawn, splashes(WHITE).length + 1)
  assertEquals(recorded, [{ key, dark: false }])
  assertEquals(objects.includes(`${sets}${key}/done`), true)
  assertEquals(objects.some((k) => k.includes('/0000/')), false)
})

test('a kept set is recorded without drawing, and a recorded one is left', async () => {
  let kept = await run([`${sets}${key}/done`])
  assertEquals([kept.drawn, kept.recorded.length, kept.said], [0, 1, 'kept'])
  let held = await run([], { key, dark: false })
  assertEquals([held.drawn, held.recorded.length, held.said], [0, 0, 'current'])
})

test('a background is read from the root, the body or --bg, in each scheme', () => {
  let cases: [string[], { light: string; dark: string | null }][] = [
    [['html { background-color: #222 } body { background: #fff }'], {
      light: '#222222',
      dark: null,
    }],
    [['body{background:url(a.png) no-repeat,#abcdef}'], {
      light: '#abcdef',
      dark: null,
    }],
    [[':root{--paper:#eee;--bg:var(--paper)}'], {
      light: '#eeeeee',
      dark: null,
    }],
    [[':root{color-scheme:light dark;--bg:light-dark(#fafafa, #101010)}'], {
      light: '#fafafa',
      dark: '#101010',
    }],
    [['@layer base{:where(body){background:var(--bg,#fff)}}'], {
      light: '#ffffff',
      dark: null,
    }],
    [[
      'body{background:#fff}',
      '@media (prefers-color-scheme:dark){body{background:#000}}',
    ], { light: '#ffffff', dark: '#000000' }],
    [
      ['@media (min-width: 40rem) { body { background: red } } body { background: oklch(0.9 0 0) }'],
      WHITE,
    ],
  ]
  for (let [sheets, want] of cases) {
    assertEquals(palette({ sheets }), want, sheets.join(' '))
  }
})
