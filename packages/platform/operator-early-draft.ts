/** Keep edits made in the server-drawn box until the draft desk takes them. */
type Early = {
  composing: () => boolean
  take: (restore: (text: string) => boolean) => void
}

type Field = HTMLTextAreaElement & { [key: symbol]: Early | undefined }

// Keep this source literal. It runs in the page and has no access to any
// helpers introduced by the Worker's bundler.
let ARM = `(root, browser) => {
  let field = root.querySelector('textarea[name=say]')
  if (!field) return
  let key = Symbol.for('yaks.operator.early')
  let button = root.querySelector('button[type=submit]')
  if (button) button.disabled = true
  if (!field[key]) {
    let prefix = 'yak:operator-early:' + root.dataset.earlyDraft + ':'
    let entry, text = '', composing = false
    let edited = () => {
      text = field.value
      try {
        entry ??= prefix + browser.crypto.randomUUID()
        if (text) browser.localStorage.setItem(entry, text)
        else browser.localStorage.removeItem(entry)
      } catch (error) {
        browser.reportError?.(error)
      }
    }
    let start = () => {
      composing = true
    }
    let end = () => {
      composing = false
      edited()
    }
    field.addEventListener('input', edited)
    field.addEventListener('compositionstart', start)
    field.addEventListener('compositionend', end)
    // The native form still works without scripts. With scripts, sending
    // waits for the draft desk so the message and its draft spend together.
    field[key] = {
      composing: () => composing,
      take: (restore) => {
        let saved = []
        try {
          let disk = browser.localStorage
          for (let i = 0; i < disk.length; i++) {
            let name = disk.key(i)
            if (!name?.startsWith(prefix)) continue
            let value = disk.getItem(name)
            if (value) saved.push([name, value])
          }
        } catch (error) {
          browser.reportError?.(error)
        }
        let taken = saved.filter(([name, value]) =>
          name != entry && restore(value)
        )
        if (text && restore(text) && entry) taken.push([entry, text])
        try {
          for (let [name, value] of taken) {
            if (browser.localStorage.getItem(name) == value) {
              browser.localStorage.removeItem(name)
            }
          }
        } catch (error) {
          browser.reportError?.(error)
        }
        field.removeEventListener('input', edited)
        field.removeEventListener('compositionstart', start)
        field.removeEventListener('compositionend', end)
        delete field[key]
        let send = root.querySelector('button[type=submit]')
        if (send) send.disabled = false
      },
    }
  }

  if (root.closest('[hidden], [inert]')) return
  browser.requestAnimationFrame(() =>
    browser.setTimeout(() => {
      if (!field.isConnected || !field.getClientRects().length) return
      let { performance } = browser
      if (!performance.getEntriesByName('yak-usable').length) {
        performance.mark('yak-usable')
        browser[Symbol.for('yaks.open')]?.ready(true)
      }
    }, 0)
  )
}`

/** The script stands immediately after its box. */
export let earlyDraftScript = (): string =>
  `(${ARM})(document.currentScript.previousElementSibling,window)`

/** The service worker supplies the same handoff to its scriptless pictures. */
export let keptDraftScript = (): string =>
  `document.addEventListener('DOMContentLoaded', () => {
    for (let root of document.querySelectorAll('[data-early-draft]')) {
      (${ARM})(root, window)
    }
  }, { once: true })`

/** Take the edits before hydration can set the textarea's value. */
export let takeEarlyDraft = (
  root: Element,
  restore: (text: string) => boolean,
  signal: AbortSignal,
): Promise<void> | void => {
  let field = root.querySelector<Field>('textarea[name=say]')
  let early = field?.[Symbol.for('yaks.operator.early')]
  if (!early || !field) return
  if (!early.composing()) return early.take(restore)
  return new Promise<void>((done) => {
    let stop = new AbortController()
    let finish = () => {
      stop.abort()
      if (!signal.aborted) early.take(restore)
      done()
    }
    field.addEventListener('compositionend', finish, { signal: stop.signal })
    signal.addEventListener('abort', finish, { signal: stop.signal })
  })
}
