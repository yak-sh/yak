import { AHEAD, READY } from '@yaks/ui/navigate'
import { MANAGE } from './routes.ts'

export let WHO = '/login/who'
/** The site's sign-in check also wakes the Operator it will open next. */
export let CHAT = 'chat'
/** And answers the pencil's tag for a person who may write the site's pages,
 * which the page then draws (public/edit.js at `pencil`). */
export let PENCIL = 'pencil'

/** The link shown beside Sign in once the browser knows it is signed in. */
export let signedIn =
  `<a class="Nav_Link Nav_Open" href="${MANAGE}">Open yaks.app</a>`

/** The site's cached pages paint and warm the remembered link first. For a
 * newly recognized session, the check supplies the chat directly. A Home
 * that the browser prerenders waits for activation before starting either
 * request, so it cannot compete with a conversation the person is opening.
 * A page of the home app, the same for everyone, names its `pencil` script:
 * the check answers its tag for a person who may write the page, and the
 * island draws it. */
export let island = (module: string, pencil?: string) =>
  `<script>(open => {
  if (document.prerendering) {
    document.addEventListener('prerenderingchange', open, { once: true })
  } else open()
})(() => {
  let root = document.documentElement, key = 'yak:signed'
  let mark = (on) => root.toggleAttribute('data-signed', on)
  try { mark(!!localStorage.getItem(key)) } catch {}
  let remembered = root.hasAttribute('data-signed')
  let checking = fetch('${WHO}?${CHAT}${
    pencil ? `&${PENCIL}` : ''
  }').then((r) => r.ok ? r.json() : null, () => null)
  let linkToOpen = () => document.querySelector('.Nav_Open')
  let who
  checking.then((answer) => {
    who = answer
    if (!who) return
    mark(who.signedIn)
    try {
      who.signedIn ? localStorage.setItem(key, '1') : localStorage.removeItem(key)
    } catch {}
    if (!who.signedIn) linkToOpen()?.removeAttribute('${READY}')
    if (who.pencil && ${!!pencil}) {
      let tag = document.createElement('script')
      let release = document.querySelector('script[data-yak-version]')?.dataset.yakVersion
      if (release) tag.dataset.yakVersion = release
      for (let [name, value] of Object.entries(who.pencil)) tag.setAttribute(name, value)
      tag.src = ${JSON.stringify(pencil ?? '')}
      document.head.append(tag)
    }
  }).catch((error) => globalThis.reportError?.(error))
  let warm = async () => {
    let to = remembered ? '${MANAGE}' : (await checking)?.chat
    if (!to) return
    let first = fetch(to, {
      headers: { accept: 'text/html', '${AHEAD}': 'prefetch' },
      credentials: 'same-origin',
    }).catch(() => null)
    let { ready } = await import(${JSON.stringify(module)})
    let link = linkToOpen()
    if (!link && document.readyState == 'loading') {
      await new Promise((done) => document.addEventListener('DOMContentLoaded', done, { once: true }))
      link = linkToOpen()
    }
    if (link && who?.signedIn !== false) {
      return ready(link, to, first)
    }
  }
  let warming = warm().catch((error) => globalThis.reportError?.(error))
  let pressed = false
  document.addEventListener('click', (e) => {
    let link = e.target?.closest?.('.Nav_Open')
    if (!link || link.hasAttribute('${READY}') || e.defaultPrevented ||
        e.button > 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    e.preventDefault()
    if (pressed) return
    pressed = true
    let follow = () => location.assign(link.href)
    warming.then((open) => open ? open(e) : follow()).catch((error) => {
      globalThis.reportError?.(error)
      follow()
    }).finally(() => pressed = false)
  })
})</script>`
