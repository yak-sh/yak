// A dashboard page moves onto the deploy serving yaks.app now, rather than
// running the code it was drawn with for as long as it stays open (T-147003),
// and never by reloading under the person (T-3497).
//
// The page wears the deploy that drew it (pages.ts `documented`), and asks
// /login/who which deploy answers now: as it comes back into view, at most
// once a minute; as the network comes back; and as its socket opens again
// (`yak-reconnect`, the Operator's chat), which every deploy makes it do.
//
// A newer deploy is taken at the next link the person follows: this script
// holds the page (`data-stays`), so the navigator (@yaks/ui/navigate) loads
// that page whole from the new deploy instead of laying it over this one in
// place. Until then the page carries on as drawn; nothing reloads it.
{
  let script = document.currentScript
  let mine = script?.dataset.deploy
  let drawn = Date.parse(script?.dataset.deployAt ?? '')

  let asking = false
  let ask = async () => {
    if (!mine || asking || script.hasAttribute('data-stays')) return
    asking = true
    try {
      let response = await fetch('/login/who', { cache: 'no-store' })
        .catch(() => null)
      if (!response?.ok) return
      let now = (await response.json()).deploy
      if (now?.id && now.id != mine && Date.parse(now.at) > drawn) {
        script.setAttribute('data-stays', '')
      }
    } finally {
      asking = false
    }
  }

  let seen = Date.now()
  let returned = () => {
    if (document.visibilityState != 'visible') return
    if (Date.now() - seen < 60000) return
    seen = Date.now()
    ask()
  }
  document.addEventListener('visibilitychange', returned)
  addEventListener('pageshow', (e) => e.persisted && returned())
  addEventListener('online', ask)
  addEventListener('yak-reconnect', ask)
}
