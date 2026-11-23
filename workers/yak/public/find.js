// The connections page's search, as a person types (desk-pages.ts
// `connections`): the page is asked again with what was typed, and what it
// found takes the place of what the page showed under the box. Without this
// script the search still works when its form is sent. A page brought in
// place (@yaks/ui/navigate) is bound again, and let go when it leaves.
{
  let find = () => {
    let leave = new AbortController()
    addEventListener('yak-leave', () => leave.abort(), { once: true })
    let form = document.querySelector('form[data-find]')
    let box = form?.querySelector('input[name=q]')
    let asked = 0
    let timer
    let swap = async () => {
      let mine = ++asked
      let to = new URL(form.action, location.href)
      for (let [k, v] of new FormData(form)) to.searchParams.set(k, String(v))
      let res = await fetch(to, { credentials: 'same-origin' }).catch(() =>
        null
      )
      if (mine != asked || !res?.ok) return
      let page = new DOMParser().parseFromString(await res.text(), 'text/html')
      let now = page.querySelector('[data-found]')
      let was = document.querySelector('[data-found]')
      if (!now || !was || mine != asked) return
      was.replaceWith(now)
      history.replaceState(null, '', `${to.pathname}${to.search}#find`)
    }
    box?.addEventListener('input', () => {
      clearTimeout(timer)
      timer = setTimeout(swap, 200)
    }, { signal: leave.signal })
  }
  find()
  addEventListener('yak-page', find)
}
