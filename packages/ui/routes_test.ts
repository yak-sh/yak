import { test } from '@yaks/testing'
import { assert, assertEquals } from '@std/assert'
import { stops } from './guide.ts'
import { kit } from './kit.ts'
import { routes } from './routes.ts'

let [ui] = routes()
let get = async (q = '') =>
  (await ui.handle(new Request(`http://box/ui${q}`))).text()

test('/ui answers the style guide, dressed, with no script', async () => {
  assertEquals([ui.method, ui.path], ['GET', '/ui'])
  let res = await ui.handle(new Request('http://box/ui'))
  assertEquals(res.headers.get('content-type'), 'text/html; charset=utf-8')
  let page = await res.text()
  assert(page.includes('<span class="Dot Dot-ring"></span>'))
  assert(page.includes('--bg:'))
  assert(!page.includes('<script'))
})

test("/ui's contents jump to every group's and every part's section", async () => {
  let page = await get()
  for (let stop of [...stops, ...Object.keys(kit)]) {
    assert(page.includes(`href="#${stop}"`), `a link to ${stop}`)
    assert(page.includes(`id="${stop}"`), `a section for ${stop}`)
  }
})

test('/ui switches theme and scheme by link', async () => {
  let page = await get('?theme=rosepine&scheme=light')
  assert(page.includes('<html style="color-scheme: light">'))
  assert(page.includes('#191724')) // Rosé Pine's floor
  assert(!page.includes('#232a2e')) // not Everforest's
  // Each tab keeps the other choice; the one showing is on.
  assert(page.includes('href="?theme=everforest&amp;scheme=light"'))
  assert(page.includes('href="?theme=rosepine&amp;scheme=dark"'))
  assert(page.includes('scheme=light" class="Tabs_Tab Tabs_Tab-on">rosepine<'))
  // What names nothing is the default: the first theme, the system's scheme.
  let fallback = await get('?theme=nope&scheme=sepia')
  assert(
    fallback.includes('#232a2e') &&
      fallback.startsWith('<!doctype html><html><head>'),
  )
})

test('/ui keeps the base beside installed kits, skins and UX specimens', async () => {
  let { h } = await import('preact')
  let { everforest } = await import('./everforest.ts')
  let [route] = routes({
    ui: {
      kits: {
        outside: {
          Sample: {
            Component: () => h('p', {}, 'outside'),
            css: new URL('data:text/css,.Sample{display:block}'),
            sheet: () => ({}),
            description: 'an installed part',
            specimens: () => [['sample', h('p', {}, 'outside')]],
          },
        },
      },
      themes: { outside: everforest },
      skins: {
        outside: {
          Sample: { css: new URL('data:text/css,.Sample{display:grid}') },
        },
      },
      ux: {
        outside: {
          description: 'behaviour',
          components: {
            SampleUX: {
              description: 'external behaviour',
              specimens: () => [['ux', h('p', {}, 'ux outside')]],
            },
          },
        },
      },
    },
  })
  let page =
    await (await route.handle(new Request('http://box/ui?skin=outside'))).text()
  for (
    let text of [
      'id="Button"',
      'id="ui/outside/Sample"',
      'id="ux/outside/SampleUX"',
      '.Sample{display:grid}',
      'data-skin="skin"',
      'ux outside',
    ]
  ) {
    assert(page.includes(text), text)
  }
  assert(!page.includes('.Sample{display:block}'))
  let [empty] = routes({ ui: { kits: {}, themes: {}, skins: {}, ux: {} } })
  assert(
    (await (await empty.handle(new Request('http://box/ui'))).text()).includes(
      'id="Button"',
    ),
  )
})
