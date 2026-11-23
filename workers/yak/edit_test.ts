// The corner of an app's pages (public/edit.js), its note to the Operator and
// its pencil: who is sent it, how it is woven, and that it draws beside the
// page rather than in it. Edit mode itself is edit-mode_test.ts.
import { equal, ok, test } from '@yaks/testing'
import { parseHTML } from 'linkedom'
import { aloneOf, cornerOf, editOf } from './apps.ts'
import type { App, Space } from './directory.ts'
import { pageScript } from './page-script.ts'
import { assets } from './binding-probe.ts'

let ASSETS = assets(new URL('./public/', import.meta.url))
let code = await Deno.readTextFile(
  new URL('./public/edit.js', import.meta.url),
)
let space = { slug: 'ada' } as Space
let app = { slug: 'cookbook' } as App
let CHAT = 'https://yaks.app/ada?app=cookbook'
let NOTE = 'https://yaks.app/manage/ada/operator?note=cookbook'

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

test('the note, a page of yaks.app, rides with the chat', () => {
  let corner = (who: object) => cornerOf(space, app, {}, who as never)
  equal(corner({ person: 'p', role: 'editor' }), { edit: CHAT, note: NOTE })
  equal(corner({ person: 'p', role: 'viewer' }), { edit: null, note: null })
})

test("a member's page is never one Site keeps for everyone", () => {
  equal(aloneOf({ person: null, role: null }), 'stranger')
  equal(aloneOf({ person: 'p', role: null }), 'outsider')
  equal(aloneOf({ person: 'p', role: 'editor' }), null)
})

let woven = async (edit?: string, note?: string) => {
  let { tags, hashes } = await pageScript(ASSETS, '/cookbook/', 1, {
    badge: 'https://yaks.app/',
    edit,
    note,
  })
  let scripts = [...parseHTML(tags).document.querySelectorAll('script')]
  return { scripts, hashes }
}

test('the pencil is woven after the badge, saying where the chat is', async () => {
  let { scripts, hashes } = await woven(CHAT, NOTE)
  let pencil = scripts.at(-1)!
  equal(pencil.textContent, code)
  equal(pencil.getAttribute('data-yak-edit'), CHAT)
  equal(pencil.getAttribute('data-yak-note'), NOTE)
  ok(scripts.at(-2)!.hasAttribute('data-yak-badge'))
  equal(hashes.length, scripts.length)
  ok(!(await woven()).scripts.some((s) => s.textContent == code))
})

let drawn = (attrs: string) => {
  let win = parseHTML(
    `<html><head><script data-yak-at="/cookbook/" ${attrs}></script></head><body><h2>Dues</h2><p>Paid in May.</p></body></html>`,
  )
  let doc = win.document
  Object.defineProperty(doc, 'currentScript', {
    value: doc.querySelector('script'),
  })
  let stored = new Map<string, string>()
  // The closed root opened, so a test can press what is in it.
  let attach = win.HTMLElement.prototype.attachShadow
  win.HTMLElement.prototype.attachShadow = function (this: HTMLElement) {
    return roots[roots.push(attach.call(this, { mode: 'open' })) - 1]
  }
  let world = {
    document: doc,
    open: (...args: unknown[]) => opened.push(args),
    location: { href: 'https://ada.yaks.app/cookbook/' },
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
  return doc
}
let roots: ShadowRoot[] = [], opened: unknown[][] = []

test("the note opens yaks.app's own page with the passage, never sending from this one", () => {
  let doc = drawn(
    `data-yak-edit="${CHAT}" data-yak-note="${NOTE}" data-yak-version="7"`,
  )
  let note = roots.at(-1)!.querySelector<HTMLButtonElement>('.note')!
  ok(!note.hidden)
  let p = doc.querySelector('p')!
  doc.getSelection = () =>
    ({
      isCollapsed: false,
      anchorNode: p.firstChild,
      toString: () => 'Paid in May.',
    }) as never
  note.dispatchEvent(new doc.defaultView!.Event('click'))
  let [[to, name, features]] = opened.splice(0) as string[][]
  let at = new URL(to)
  equal(at.origin + at.pathname + '?note=' + at.searchParams.get('note'), NOTE)
  equal(JSON.parse(at.searchParams.get('about')!), {
    page: 'https://ada.yaks.app/cookbook/',
    title: '',
    selection: 'Paid in May.',
    section: 'Dues',
    release: 7,
  })
  equal(name, '_blank')
  ok(features.includes('noopener'))
  ok(!doc.querySelector('textarea') && !roots.at(-1)!.querySelector('form'))
})

test('it draws beside the body, where a page redrawing its body leaves it', () => {
  let doc = drawn(`data-yak-edit="${CHAT}"`)
  let host = doc.querySelector('yaks-edit')!
  equal(host.parentNode, doc.documentElement)
  doc.body.innerHTML = '<p>Redrawn</p>'
  ok(doc.querySelector('yaks-edit'))
})
