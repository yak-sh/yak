import { MANAGE } from './routes.ts'

export let WHO = '/login/who'
/** The site's sign-in check also wakes the Operator it will open next. */
export let CHAT = 'chat'

/** The link shown beside Sign in once the browser knows it is signed in. */
export let signedIn =
  `<a class="Nav_Link Nav_Open" href="${MANAGE}">Open yaks.app</a>`

/** The site's cached pages paint the remembered link first. The browser's
 * session check supplies the chat to keep ready. */
export let island = (module: string) =>
  `<script>(() => {
  let root = document.documentElement, key = 'yak:signed'
  let mark = (on) => root.toggleAttribute('data-signed', on)
  try { mark(!!localStorage.getItem(key)) } catch {}
  fetch('${WHO}?${CHAT}').then((r) => r.ok ? r.json() : null).then(async (who) => {
    if (!who) return
    mark(who.signedIn)
    try {
      who.signedIn ? localStorage.setItem(key, '1') : localStorage.removeItem(key)
    } catch {}
    if (!who.chat) return
    let { ready } = await import(${JSON.stringify(module)})
    if (document.readyState == 'loading') {
      await new Promise((done) => document.addEventListener('DOMContentLoaded', done, { once: true }))
    }
    let link = document.querySelector('.Nav_Open')
    if (link) ready(link, who.chat)
  }, () => {}).catch((error) => globalThis.reportError?.(error))
})()</script>`
