/** The back office's page: yaks.app's look (@yaks/ui's linen theme and
 * pencil skin), then the shop this app is attached to, read from
 * `./api/env` (store_attach), drawn by office.js. */
import { kits, skins, stylesheet, themes } from '@yaks/ui'
import { open } from './office.js'
import { stores } from './shop.js'

let root = document.getElementById('office')
let say = (text) => {
  let p = document.createElement('p')
  p.className = 'Notice'
  p.textContent = text
  root.replaceChildren(p)
}

let style = document.createElement('style')
style.textContent = await stylesheet({
  kits,
  theme: themes.linen,
  skin: skins.pencil,
})
document.head.append(style)

// client.js is served beside the page, so its URL is resolved at runtime.
let client = await import(new URL('api/client.js', document.baseURI).href)
let env = await (await fetch(new URL('api/env', document.baseURI))).json()
  .catch(() => ({}))
let attached = stores(env)
let picked = new URLSearchParams(location.search).get('shop')
let [, address] = attached.find(([name]) => name == picked) ?? attached[0] ??
  []

if (!address) {
  say(
    'This back office is not attached to a shop yet. Ask your Operator to ' +
      'attach it to the app that sells, with store_attach and the binding ' +
      'STORE.',
  )
} else {
  let shop = client.store(address)
  let home = new URL(address.replace(/api\/$/, ''), location.origin)
  await open({
    root,
    shop: { ...shop, draftEid: client.draftEid },
    view: window,
    files: new URL('blob/', new URL(address, location.origin)).href,
    home: home.href,
    uuid: () => crypto.randomUUID(),
  })
}
