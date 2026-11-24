// Cancel stale searches before replacing their results. Domain writes keep
// their input until the response is drawn or checkout takes over.
import { leaving, PAGE } from '@yaks/ui/navigate'
import { result } from '@yaks/ui/interaction'

let say = (box: Element, text: string, problem = false) => {
  box.textContent = text
  box.toggleAttribute('hidden', !text)
  box.classList.toggle('Notice-negative', problem)
}

let search = (
  form: HTMLFormElement,
  note: HTMLElement,
  signal: AbortSignal,
) => {
  let doc = form.ownerDocument
  let field = form.querySelector<HTMLInputElement>('[name=q]')!
  let results = doc.querySelector('[data-domain-results]')!
  let timer: ReturnType<typeof setTimeout>
  let pending: AbortController | undefined
  let find = async (input?: Event) => {
    let q = field.value.trim()
    results.replaceChildren()
    if (!q) return say(note, '')
    let pressed = input && result(doc, input)
    say(note, 'Searching…')
    let current = pending = new AbortController()
    let url = new URL(form.action)
    url.searchParams.set('search', q)
    let began = performance.now(), server: number | undefined
    try {
      let r = await fetch(url, {
        signal: AbortSignal.any([signal, current.signal]),
      })
      if (!r.ok || r.redirected) throw new Error('Search failed')
      let html = await r.text()
      server = performance.now() - began
      if (current.signal.aborted || signal.aborted) return
      results.innerHTML = html
      let count = results.querySelectorAll('[data-available]').length
      say(
        note,
        count == 1 ? '1 domain available.' : `${count} domains available.`,
      )
    } catch {
      if (!current.signal.aborted && !signal.aborted) {
        say(note, 'Search could not load. Try again.', true)
      }
    } finally {
      if (current.signal.aborted || signal.aborted) pressed?.cancel()
      else pressed?.drawn(server ?? performance.now() - began)
    }
  }
  let reset = () => {
    clearTimeout(timer)
    pending?.abort()
  }
  field.addEventListener('input', () => {
    reset()
    results.replaceChildren()
    say(note, field.value.trim() ? 'Searching…' : '')
    timer = setTimeout(find, 325)
  }, { signal })
  form.addEventListener('submit', (e) => {
    e.preventDefault()
    reset()
    void find(e)
  }, { signal })
  signal.addEventListener('abort', reset, { once: true })
}

let posts = (doc: Document, note: HTMLElement, signal: AbortSignal) => {
  doc.addEventListener('submit', async (e) => {
    let form = e.target as HTMLFormElement
    let buying = form.matches('[data-domain-buy]')
    let transfer = form.matches('[data-domain-transfer]')
    if (!buying && !transfer && !form.matches('[data-domain-target]')) return
    e.preventDefault()
    let pressed = result(doc, e)
    let data = new FormData(form)
    let button = form.querySelector<HTMLButtonElement>('button[type="submit"]')!
    let box = buying ? note : form.querySelector('[data-domain-message]')!
    button.disabled = true
    say(box, buying ? 'Opening checkout…' : transfer ? 'Offering…' : 'Saving…')
    let began = performance.now(), server: number | undefined, leaving = false
    try {
      let r = await fetch(form.action, {
        method: 'POST',
        body: data,
        headers: { accept: 'application/json' },
        signal,
      })
      let out = await r.json()
      server = performance.now() - began
      if (!r.ok) {
        say(
          box,
          out.error?.message ?? out.say ??
            'That did not go through. Try again.',
          true,
        )
        return
      }
      if (buying) {
        leaving = true
        pressed?.cancel()
        return location.assign(out.url)
      }
      if (transfer) return say(box, out.say)
      form.closest('[data-owned-domain]')!.outerHTML = out.row
      let saved = doc.getElementById(String(data.get('point_domain')))!
      say(saved.querySelector('[data-domain-message]')!, 'Saved.')
      saved.querySelector<HTMLButtonElement>('button[type="submit"]')!.focus()
    } catch {
      if (!signal.aborted) say(box, 'That did not go through. Try again.', true)
    } finally {
      button.disabled = false
      if (signal.aborted) pressed?.cancel()
      else if (!leaving) pressed?.drawn(server ?? performance.now() - began)
    }
  }, { signal })
}

let bind = (doc: Document) => {
  let form = doc.querySelector<HTMLFormElement>('[data-domain-search]')
  let note = doc.querySelector<HTMLElement>('[data-search-status]')
  if (!form || !note) return
  let signal = leaving(doc)
  search(form, note, signal)
  posts(doc, note, signal)
}

if (typeof document != 'undefined') {
  bind(document)
  document.addEventListener(PAGE, () => bind(document))
}
