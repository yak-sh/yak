// Leaving yaks.app in a new tab. Every page's shell loads it once, and it
// listens on the document, so a link drawn anywhere on a page opens the same
// way: the page's own, Markdown someone wrote, an Operator's message drawn
// later by a script.
//
// A link to an http or https address off yaks.app (its apex and every
// space's host under it, `data-home`, else the host this file came from)
// opens in a new tab with rel="noopener", so the person's yaks.app tab stays
// where it was. A link that names its own target, or a download, is left as
// it says; so are mailto:, tel: and sms:, and every link within yaks.app.
//
// A form that sends itself to a new tab (a connection's sign-in at its
// broker, desk-pages.ts `connection`) leaves this page as it was before the
// sign-in finished there, so the page is read again when the person comes
// back to it.
{
  let script = document.currentScript
  let home = script?.dataset.home ||
    (script?.src ? new URL(script.src).hostname : location.hostname)
  let ours = (host) => host == home || host.endsWith(`.${home}`)

  let leaving = (href) => {
    let to
    try {
      to = new URL(href, location.href)
    } catch {
      return false
    }
    return /^https?:$/.test(to.protocol) && !ours(to.hostname)
  }

  addEventListener('click', (e) => {
    if (e.defaultPrevented) return
    let link = e.target.closest?.('a[href]')
    if (!link || link.hasAttribute('target') || link.hasAttribute('download')) {
      return
    }
    if (!leaving(link.getAttribute('href'))) return
    link.setAttribute('target', '_blank')
    let rel = (link.getAttribute('rel') ?? '').split(/\s+/).filter(Boolean)
    if (!rel.includes('noopener')) rel.push('noopener')
    link.setAttribute('rel', rel.join(' '))
  })

  let away = false
  addEventListener('submit', (e) => {
    let target = e.submitter?.getAttribute('formtarget') ??
      e.target.getAttribute?.('target')
    if (target == '_blank') away = true
  })
  document.addEventListener('visibilitychange', () => {
    if (away && document.visibilityState == 'visible') location.reload()
  })
}
