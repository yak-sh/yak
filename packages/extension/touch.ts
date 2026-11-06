// Touching the page a tab shows: listing what can be pressed or typed into,
// each named by a short **ref** (`e1`, `e2`, …), and clicking or typing into
// one by its ref.
//
// `touch` runs inside the page, like ./read.ts `read`: the browser glue hands
// it to `chrome.scripting.executeScript({func: touch, args})`, so it closes
// over nothing in this module. The elements a listing named are held in
// `held`, which in the browser is the extension's own isolated world for the
// page: its globals outlive one call and the page's scripts can't see them,
// so a page can't move a ref onto another element. A new page is a new world,
// so its refs start again. Its result crosses back by structured clone.

/** One thing on a page a person can press or type into, as the agent is told
 * of it. Every string but `ref` and `role` is the page's own words. */
export type Control = {
  ref: string
  /** What it is: `link`, `button`, `textbox`, `searchbox`, `checkbox`,
   * `radio`, `select`, or the role the page gave it. */
  role: string
  /** What it says or is labelled, as a person reads it. */
  name: string
  /** Pressing it submits a form: a submit button. */
  submits?: boolean
  /** It sits in a form, so Enter in it may submit that form. */
  form?: boolean
  /** It is a search: its own role or type says so, or a search landmark
   * holds it. */
  search?: boolean
  href?: string
  /** A field's value; a password's is never read. */
  value?: string
  checked?: boolean
  disabled?: boolean
  /** A select's options, as their words. */
  options?: string[]
}

/** What a touch gives back: the controls it found or acted on, or why it
 * could not. */
export type Touched = { controls: Control[]; error?: string }

/** What a touch does: `list` names every control afresh; `find` describes the
 * one a ref names; `click` and `type` act on it, once its name is still the
 * name given, so a page that changed under a wait is not acted on. */
export type Touch = {
  op: 'list' | 'find' | 'click' | 'type'
  ref?: string
  name?: string
  text?: string
  enter?: boolean
}

/** A touch on a document, holding refs in `held`. */
export let touch = (
  asked: Touch,
  doc: Document = document,
  held: Record<string, unknown> = globalThis as Record<string, unknown>,
): Touched => {
  let KEY = '__touched'
  let LIMIT = 400
  let PICK = 'a[href],button,input,select,textarea,summary,[contenteditable],' +
    '[role=button],[role=link],[role=checkbox],[role=radio],[role=switch],' +
    '[role=tab],[role=menuitem],[role=option],[role=textbox],' +
    '[role=searchbox],[role=combobox]'
  let HIDDEN = /(^|;)\s*(display\s*:\s*none|visibility\s*:\s*hidden)/i
  let PRESSED = /^(submit|button|reset|image)$/
  let words = (s: string | null | undefined) =>
    (s ?? '').replace(/\s+/g, ' ').trim()
  let cut = (s: string, n = 200) => s.length > n ? s.slice(0, n) + '…' : s
  let hidden = (el: Element): boolean => {
    for (let at: Element | null = el; at; at = at.parentElement) {
      if (
        at.hasAttribute('hidden') || at.getAttribute('aria-hidden') == 'true' ||
        HIDDEN.test(at.getAttribute('style') ?? '')
      ) return true
    }
    return 'checkVisibility' in el &&
      !el.checkVisibility({ visibilityProperty: true })
  }
  let tag = (el: Element) => el.tagName.toLowerCase()
  let type = (el: Element) => (el.getAttribute('type') ?? '').toLowerCase()
  let editable = (el: Element) =>
    ['', 'true', 'plaintext-only'].includes(
      el.getAttribute('contenteditable') ?? 'false',
    )
  let roleOf = (el: Element): string => {
    let given = el.getAttribute('role')
    if (given) return given
    let t = tag(el)
    if (t == 'a') return 'link'
    if (t == 'button' || t == 'summary') return 'button'
    if (t == 'select') return 'select'
    if (t == 'textarea' || editable(el)) return 'textbox'
    if (t != 'input') return t
    let ty = type(el)
    return PRESSED.test(ty)
      ? 'button'
      : ty == 'checkbox' || ty == 'radio'
      ? ty
      : ty == 'search'
      ? 'searchbox'
      : 'textbox'
  }
  let labels = (el: Element) => {
    let id = el.getAttribute('id')
    let by = id
      ? Array.from(doc.querySelectorAll('label'))
        .filter((l) => l.getAttribute('for') == id)
      : []
    let wrap = el.closest('label')
    return [...by, ...wrap ? [wrap] : []].map((l) => words(l.textContent))
      .join(' ')
  }
  let nameOf = (el: Element): string => {
    let by = (el.getAttribute('aria-labelledby') ?? '').split(/\s+/)
      .map((id) => id && doc.getElementById(id)?.textContent).filter(Boolean)
    let field = ['input', 'select', 'textarea'].includes(tag(el))
    let pressed = tag(el) == 'input' && PRESSED.test(type(el))
    return words(
      el.getAttribute('aria-label') ||
        by.join(' ') ||
        (field && !pressed ? labels(el) : '') ||
        (pressed ? el.getAttribute('value') || el.getAttribute('alt') : '') ||
        (field ? '' : el.textContent) ||
        el.querySelector('img[alt]')?.getAttribute('alt') ||
        el.getAttribute('placeholder') ||
        el.getAttribute('title') ||
        el.getAttribute('name'),
    )
  }
  let formOf = (el: Element) =>
    (el as HTMLInputElement).form ?? el.closest('form')
  let describe = (el: Element, ref: string): Control => {
    let role = roleOf(el)
    let t = tag(el), ty = type(el)
    let c: Control = { ref, role, name: cut(nameOf(el), 120) }
    let form = formOf(el)
    if (form) c.form = true
    if (
      form && (
        (t == 'button' && (ty == '' || ty == 'submit')) ||
        (t == 'input' && (ty == 'submit' || ty == 'image'))
      )
    ) c.submits = true
    if (role == 'searchbox' || el.closest('[role=search],search')) {
      c.search = true
    }
    if (t == 'a') c.href = (el as HTMLAnchorElement).href || undefined
    if (role == 'checkbox' || role == 'radio' || role == 'switch') {
      c.checked = (el as HTMLInputElement).checked ??
        el.getAttribute('aria-checked') == 'true'
    } else if (t == 'select') {
      let s = el as HTMLSelectElement
      let opts = Array.from(s.querySelectorAll('option'))
      c.options = opts.slice(0, 30).map((o) => cut(words(o.textContent), 60))
      let chosen = opts.find((o) => o.selected) ?? opts[0]
      if (chosen) c.value = words(chosen.textContent)
    } else if (t == 'textarea' || (t == 'input' && !PRESSED.test(ty))) {
      if (ty != 'password') c.value = cut((el as HTMLInputElement).value ?? '')
    } else if (editable(el)) c.value = cut(words(el.textContent))
    if (
      el.hasAttribute('disabled') || el.getAttribute('aria-disabled') == 'true'
    ) {
      c.disabled = true
    }
    return c
  }
  let kept = (held[KEY] ?? []) as Element[]
  let at = (ref = '') => {
    let el = /^e\d+$/.test(ref) ? kept[Number(ref.slice(1)) - 1] : undefined
    return el?.isConnected ? el : undefined
  }
  if (asked.op == 'list') {
    let all = Array.from(doc.querySelectorAll(PICK)).filter((el) =>
      !(tag(el) == 'input' && type(el) == 'hidden') && !hidden(el)
    )
    held[KEY] = all.slice(0, LIMIT)
    let listed = (held[KEY] as Element[]).map((el, i) =>
      describe(el, `e${i + 1}`)
    )
    return all.length > LIMIT
      ? {
        controls: listed,
        error:
          `The page has ${all.length} controls; these are its first ${LIMIT}.`,
      }
      : { controls: listed }
  }
  let el = at(asked.ref)
  if (!el) return { controls: [] }
  let was = describe(el, asked.ref!)
  if (asked.op == 'find') return { controls: [was] }
  if (was.name != asked.name) {
    return {
      controls: [was],
      error: 'it changed while the person was asked',
    }
  }
  if (was.disabled) return { controls: [was], error: 'it is disabled' }
  let h = el as HTMLElement
  h.scrollIntoView?.({ block: 'center' })
  h.focus?.()
  if (asked.op == 'click') {
    h.click()
    return { controls: [was] }
  }
  let text = asked.text ?? ''
  let win = doc.defaultView
  let fire = (name: string) =>
    el!.dispatchEvent(new (win?.Event ?? Event)(name, { bubbles: true }))
  if (tag(el) == 'select') {
    let s = el as HTMLSelectElement
    let opt = Array.from(s.querySelectorAll('option')).find((o) =>
      words(o.textContent) == words(text) || o.value == text
    )
    if (!opt) return { controls: [was], error: `it has no option “${text}”` }
    for (let o of Array.from(s.querySelectorAll('option'))) {
      o.selected = o == opt
    }
    fire('input')
    fire('change')
  } else if (editable(el)) {
    let selection = doc.getSelection?.()
    selection?.selectAllChildren(el)
    if (!doc.execCommand?.('insertText', false, text)) el.textContent = text
    fire('input')
  } else if ('value' in el) {
    // A page's framework watches the value through its own setter, so the
    // value is set through the element's prototype, as typing would.
    let proto = Object.getPrototypeOf(el)
    let set = Object.getOwnPropertyDescriptor(proto, 'value')?.set
    set ? set.call(el, text) : ((el as HTMLInputElement).value = text)
    fire('input')
    fire('change')
  } else return { controls: [was], error: 'it is not a field' }
  if (asked.enter) {
    // A document without keyboard events (one parsed, not shown) gets plain
    // ones, which the page's handlers hear all the same.
    let Key =
      (win?.KeyboardEvent ?? win?.Event ?? Event) as typeof KeyboardEvent
    let key = (name: string) =>
      el!.dispatchEvent(
        new Key(name, {
          key: 'Enter',
          code: 'Enter',
          bubbles: true,
          cancelable: true,
        }),
      )
    // A synthetic key presses nothing, so the form it would submit is
    // submitted here, unless the page took the key for itself.
    let free = key('keydown')
    key('keypress')
    key('keyup')
    let form = formOf(el)
    if (free && form) form.requestSubmit()
  }
  return { controls: [was] }
}
