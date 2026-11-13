// The pencil on an app's pages (public/edit.js): who is sent it, how it is
// woven, and that it draws beside the page rather than in it. Edit mode
// itself is edit-mode_test.ts.
import { equal, ok, test } from '@yaks/testing'
import { parseHTML } from 'linkedom'
import { aloneOf, editOf } from './apps.ts'
import type { App, Space } from './directory.ts'
import { pageScript } from './page-script.ts'
import { assets } from './binding-probe.ts'

let ASSETS = assets(new URL('./public/', import.meta.url))
let code = await Deno.readTextFile(
  new URL('./public/edit.js', import.meta.url),
)
let space = { slug: 'ada' } as Space
let app = { slug: 'cookbook' } as App
let CHAT = 'https://yaks.app/manage/ada?app=cookbook'

test('the pencil is sent to whoever the file door lets write the app', () => {
  let edit = (who: object, of = app) => editOf(space, of, {}, who as never)
  equal(edit({ person: 'p', role: 'owner' }), CHAT)
  equal(edit({ person: 'p', role: 'editor' }), CHAT)
  equal(edit({ person: 'p', role: 'viewer' }), null)
  equal(edit({ person: 'p', role: 'editor', guest: true }), null)
  equal(edit({ person: null, role: null }), null)
  let installed = { ...app, installed: { sandboxed: true } } as unknown as App
  equal(edit({ person: 'p', role: 'owner' }, installed), null)
})

test("a member's page is never one Site keeps for everyone", () => {
  equal(aloneOf({ person: null, role: null }), 'stranger')
  equal(aloneOf({ person: 'p', role: null }), 'outsider')
  equal(aloneOf({ person: 'p', role: 'editor' }), null)
})

let woven = async (edit?: string) => {
  let { tags, hashes } = await pageScript(ASSETS, '/cookbook/', 1, {
    badge: 'https://yaks.app/',
    edit,
  })
  let scripts = [...parseHTML(tags).document.querySelectorAll('script')]
  return { scripts, hashes }
}

test('the pencil is woven after the badge, saying where the chat is', async () => {
  let { scripts, hashes } = await woven(CHAT)
  let pencil = scripts.at(-1)!
  equal(pencil.textContent, code)
  equal(pencil.getAttribute('data-yak-edit'), CHAT)
  ok(scripts.at(-2)!.hasAttribute('data-yak-badge'))
  equal(hashes.length, scripts.length)
  ok(!(await woven()).scripts.some((s) => s.textContent == code))
})

test('it draws beside the body, where a page redrawing its body leaves it', () => {
  let win = parseHTML(
    `<html><head><script data-yak-at="/cookbook/" data-yak-edit="${CHAT}"></script></head><body><p>Hi</p></body></html>`,
  )
  let doc = win.document
  Object.defineProperty(doc, 'currentScript', {
    value: doc.querySelector('script'),
  })
  let stored = new Map<string, string>()
  let world = {
    document: doc,
    sessionStorage: {
      getItem: (k: string) => stored.get(k) ?? null,
      setItem: (k: string, v: string) => stored.set(k, v),
      removeItem: (k: string) => stored.delete(k),
    },
    addEventListener: () => {},
    requestAnimationFrame: () => 0,
    MutationObserver: class {
      observe() {}
    },
    innerHeight: 800,
    innerWidth: 390,
  }
  new Function(...Object.keys(world), code)(...Object.values(world))
  let host = doc.querySelector('yaks-edit')!
  equal(host.parentNode, doc.documentElement)
  doc.body.innerHTML = '<p>Redrawn</p>'
  ok(doc.querySelector('yaks-edit'))
})
