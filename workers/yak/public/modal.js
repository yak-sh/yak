// The hash is the dialog's address. Keep each body's nodes when it closes so
// reopening is instant and anything typed into a form stays where it was.
{
  let dialog = document.querySelector('dialog.Modal')
  if (dialog) {
    let cache = new Map()
    let pending = new Map()
    let active
    let page = document.querySelector('[data-connections]')
    let loading = dialog.querySelector('template[data-modal-loading]')
    let body = () => dialog.querySelector('.Modal_Body')
    let seed = dialog.dataset.modalKey
    if (seed && body()) cache.set(seed, body())
    for (
      let template of document.querySelectorAll(
        'template[data-modal-key], [hidden][data-modal-key]',
      )
    ) {
      let content = template.content?.firstElementChild ||
        template.firstElementChild
      cache.set(template.dataset.modalKey, content)
      if (template.dataset.modalAlias) {
        cache.set(template.dataset.modalAlias, content)
      }
    }
    let selected = () => {
      try {
        let key = decodeURIComponent(location.hash.slice(1))
        return key && key != 'find' ? key : undefined
      } catch {
        return undefined
      }
    }
    let show = (content) => {
      body()?.remove()
      dialog.append(content)
      dialog.setAttribute(
        'aria-label',
        content.querySelector('h2')?.textContent || 'Connection details',
      )
      content.querySelector('[autofocus]')?.focus()
    }
    let fetchBody = (key) => {
      if (!pending.has(key)) {
        let to = new URL(location.href)
        to.hash = ''
        to.searchParams.set('detail', key)
        pending.set(
          key,
          fetch(to, { credentials: 'same-origin' }).then(async (res) => {
            if (!res.ok) throw new Error(`Connection details: ${res.status}`)
            let doc = new DOMParser().parseFromString(
              await res.text(),
              'text/html',
            )
            let content = doc.querySelector(
              'dialog[data-modal-key] .Modal_Body',
            )
            if (!content) {
              throw new Error('Connection details were not returned.')
            }
            cache.set(key, content)
            return content
          }).finally(() => pending.delete(key)),
        )
      }
      return pending.get(key)
    }
    let sync = async () => {
      let key = selected()
      active = key
      page?.toggleAttribute('inert', !!key)
      if (!key) {
        if (dialog.open || dialog.hasAttribute('open')) dialog.close()
        return
      }
      show(cache.get(key) || loading.content.firstElementChild.cloneNode(true))
      if (!dialog.open && !dialog.hasAttribute('open')) dialog.showModal()
      if (cache.has(key)) return
      try {
        let content = await fetchBody(key)
        if (active == key) show(content)
      } catch (error) {
        if (active == key) {
          let line = body().querySelector('[role=status]')
          line.textContent =
            'Could not load this connection. Close and reopen to try again.'
        }
        reportError(error)
      }
    }
    let go = (hash) => {
      let to = new URL(location.href)
      to.hash = hash
      history.pushState(null, '', `${to.pathname}${to.search}${to.hash}`)
      sync()
    }
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault()
      go('')
    })
    document.addEventListener('click', (event) => {
      let link = event.target.closest('a[href]')
      if (
        !link || event.defaultPrevented || event.button > 0 || event.metaKey ||
        event.ctrlKey || event.shiftKey || event.altKey || link.target ||
        link.hasAttribute('download')
      ) return
      if (link.hasAttribute('data-modal-close')) {
        event.preventDefault()
        go('')
        return
      }
      let to = new URL(link.getAttribute('href'), location.href)
      let here = new URL(location.href)
      if (
        to.origin != here.origin || to.pathname != here.pathname ||
        to.search != here.search
      ) return
      if (!to.hash || to.hash == '#find') return
      event.preventDefault()
      go(to.hash)
    })
    globalThis.addEventListener('hashchange', sync)
    if (dialog.hasAttribute('open')) dialog.close()
    sync()
  }
}
