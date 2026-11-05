// The site's one island (T-136085): its pages are the same cached page for
// everyone, and the nav's "Sign in" becomes "Open yaks.app" for a person signed
// in. Both links ship in every page, and the root's `data-signed` says which
// one shows (style.css `.Nav_Open`). The session cookie is never a
// page's to read, so the page asks `/login/who`, and remembers the answer so
// the next page paints the right link before it hears back.
export let WHO = '/login/who'

/** The nav's link for a person signed in, where "Sign in" is: their space,
 * which opens on a chat with its Operator (route.ts `chatPath`). Said here
 * once; a drawn page's nav wears it (shell.ts `top`), and a file page is
 * given it beside its Sign in as it leaves (sheets.ts `sheeted`). */
export let signedIn = '<a class="Nav_Open" href="/manage">Open yaks.app</a>'

/** The head's script: the remembered answer first, then the one asked for. */
export let island = `<script>(() => {
  let root = document.documentElement, key = 'yak:signed'
  let mark = (on) => root.toggleAttribute('data-signed', on)
  try { mark(!!localStorage.getItem(key)) } catch {}
  fetch('${WHO}').then((r) => r.ok ? r.json() : null).then((who) => {
    if (!who) return
    mark(who.signedIn)
    try {
      who.signedIn ? localStorage.setItem(key, '1') : localStorage.removeItem(key)
    } catch {}
  }, () => {})
})()</script>`
