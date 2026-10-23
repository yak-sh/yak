/**
 * A just-enough DOM for Preact to render against outside a browser (the undom
 * trick): elements are plain objects, every mutation marks the tree dirty, and
 * whoever owns the screen paints on the next microtask. `install()` swaps
 * `globalThis.document` for this one and hands back the render root plus the
 * restore, so a process that also holds a browser document (a test suite) keeps
 * its own.
 *
 * @module
 */

let paint = { fn: () => {} }

/** Register the repaint the next dirty tree asks for. */
export let onPaint = (fn: () => void): void => {
  paint.fn = fn
}

// Exported because not every change to the screen is a change to the tree: a
// scroll and a resize move no nodes and still owe a repaint.
let dirty = false

/** Ask for a repaint; many touches in one turn coalesce into one paint. */
export let touch = (): void => {
  if (dirty) return
  dirty = true
  queueMicrotask(() => {
    dirty = false
    paint.fn()
  })
}

/** A rectangle of cells: columns left to right, rows top to bottom, the
 * right and bottom edges just past the last. */
export type Box = { left: number; top: number; right: number; bottom: number }

let none: Box = { left: 0, top: 0, right: 0, bottom: 0 }
let union = (a: Box, b: Box): Box => ({
  left: Math.min(a.left, b.left),
  top: Math.min(a.top, b.top),
  right: Math.max(a.right, b.right),
  bottom: Math.max(a.bottom, b.bottom),
})

// What the last paint did: the cells each element painted itself, and the
// elements its sheet hid.
let placed = new Map<TElement, Box>()
let hidden = new Set<TElement>()
let revealed: TElement | undefined

/** Record a paint: the screen's lines, each segment's owner the element that
 * painted it, and the elements the sheet hid. Elements measure themselves by
 * it (`getBoundingClientRect`, `checkVisibility`). */
export let place = (
  lines: { text: string; owner?: TElement }[][],
  hid: Set<TElement> = new Set(),
): void => {
  placed = new Map()
  hidden = hid
  lines.forEach((line, top) => {
    let left = 0
    for (let { text, owner } of line) {
      let cells = { left, top, right: left + text.length, bottom: top + 1 }
      let had = owner && placed.get(owner)
      if (owner && text) placed.set(owner, had ? union(had, cells) : cells)
      left = cells.right
    }
  })
}

/** The base node: parent link, sibling walk, and self-removal. */
export class TNode {
  /** The element this node hangs from, or null when detached. */
  parentNode: TElement | null = null
  /** The node after this one under the same parent. */
  get nextSibling(): TNode | null {
    let sibs = this.parentNode?.childNodes
    return sibs ? sibs[sibs.indexOf(this) + 1] ?? null : null
  }
  /** Detach this node from its parent. */
  remove() {
    this.parentNode?.removeChild(this)
  }
}

/** A text node; writing `data` dirties the tree. */
export class TText extends TNode {
  /** DOM node type, as Preact expects to read it. */
  nodeType = 3
  private text: string
  constructor(text: unknown) { // preact passes numbers through raw
    super()
    this.text = String(text)
  }
  /** The characters this node holds. */
  get data(): string {
    return this.text
  }
  set data(v: string) {
    this.text = String(v)
    touch()
  }
}

/** An element: children, class, attributes, listeners. */
export class TElement extends TNode {
  image?: import('./Image.ts').ImageSource

  // Preact uses native property presence to normalize event names to lowercase.
  onwheel = null
  onclick = null
  onmousedown = null
  onmouseup = null
  onmousemove = null
  oninput = null
  onchange = null
  onkeydown = null
  onsubmit = null
  onfocus = null
  onblur = null
  onselect = null
  onkeyup = null
  selectionStart = 0
  selectionEnd = 0
  /** Forms share their value and selection with browser components. */
  get value(): string {
    return this.attr('value') ?? ''
  }
  set value(text: string) {
    this.setAttribute('value', text)
  }
  get ownerDocument(): typeof doc {
    return doc
  }
  /** Take the focus from whatever held it; the painter shows where it is. */
  focus() {
    if (doc.activeElement && doc.activeElement != this) {
      doc.activeElement.blur()
    }
    doc.activeElement = this
    if (this.matches('input,textarea')) {
      this.setAttribute('data-caret', this.selectionStart)
    }
    this.dispatchEvent(new Event('focus'))
    touch()
  }
  blur() {
    if (doc.activeElement == this) doc.activeElement = null
    this.removeAttribute('data-caret')
    this.dispatchEvent(new Event('blur'))
    touch()
  }
  /** Press it, as a primary-button click does. */
  click() {
    dispatch(
      this,
      Object.assign(new Event('click', { bubbles: true, cancelable: true }), {
        button: 0,
        detail: 0,
        metaKey: false,
        ctrlKey: false,
        shiftKey: false,
        altKey: false,
      }),
    )
  }
  /** Keep it in sight: the scroll region around it shows it on the next
   * paint, until another element asks. */
  scrollIntoView() {
    if (revealed == this) return
    revealed?.removeAttribute('reveal')
    revealed = this
    this.setAttribute('reveal', '')
  }
  /** Where the last paint put it, in cells: every cell it or anything inside
   * it painted. Nothing painted, out of a window's sight or hidden, is an
   * empty box at the origin. */
  getBoundingClientRect(): Box & {
    x: number
    y: number
    width: number
    height: number
  } {
    let at: Box | undefined
    let add = (n: TElement) => {
      let b = placed.get(n)
      if (b) at = at ? union(at, b) : b
      for (let k of n.childNodes) if (k instanceof TElement) add(k)
    }
    add(this)
    let { left, top, right, bottom } = at ?? none
    return {
      left,
      top,
      right,
      bottom,
      x: left,
      y: top,
      width: right - left,
      height: bottom - top,
    }
  }
  /** Whether it shows: false where the last paint's sheet hid it or what
   * holds it, true out of a window's sight. */
  checkVisibility(): boolean {
    return !hidden.has(this) && (this.parentNode?.checkVisibility() ?? true)
  }
  setSelectionRange(start: number, end: number) {
    this.selectionStart = start
    this.selectionEnd = end
    if (doc.activeElement == this) this.setAttribute('data-caret', start)
  }
  /** Optional viewport layout owned by a virtual list, not DOM children. */
  viewport?: (
    width: number,
    height: number,
    style: import('./theme.ts').Style,
    sheet: import('./theme.ts').Sheet,
  ) => import('./paint.ts').Line[]

  /** DOM node type, as Preact expects to read it. */
  nodeType = 1
  /** Children in document order. */
  childNodes: TNode[] = []
  /** Present because Preact writes to it, a custom property through
   * `setProperty`; the painter reads none of it. */
  style: Record<string, unknown> & {
    setProperty: (k: string, v: string) => void
  } = {
    setProperty(k, v) {
      this[k] = v
    },
  }
  get textContent(): string {
    return this.childNodes.map((n) =>
      n instanceof TText ? n.data : (n as TElement).textContent
    ).join('')
  }
  getAttribute(k: string): string | null {
    return this.attr(k.toLowerCase()) ?? null
  }
  hasAttribute(k: string): boolean {
    return this.attr(k.toLowerCase()) != null
  }
  get tagName(): string {
    return this.localName.toUpperCase()
  }
  get parentElement(): TElement | null {
    return this.parentNode
  }
  get isContentEditable(): boolean {
    return this.attr('contenteditable') == 'true'
  }
  get href(): string {
    return this.attr('href') ?? ''
  }
  get target(): string {
    return this.attr('target') ?? ''
  }
  contains(n: TNode | null): boolean {
    for (; n; n = n.parentNode) if (n == this) return true
    return false
  }
  matches(selector: string): boolean {
    return selector.split(',').some((s) => {
      s = s.trim()
      let m = s.match(/^([\w-]+)?(?:\[([\w-]+)(?:=["']?([^"'\]]+)["']?)?\])?$/)
      if (m && (m[1] || m[2])) {
        return (!m[1] || m[1] == this.localName) &&
          (!m[2] ||
            (m[3] == null ? this.hasAttribute(m[2]) : this.attr(m[2]) == m[3]))
      }
      if (s.startsWith('.')) {
        return this.className.split(' ').includes(s.slice(1))
      }
      if (s.startsWith('#')) return this.attr('id') == s.slice(1)
      return s == '*'
    })
  }
  closest(selector: string): TElement | null {
    return this.matches(selector)
      ? this
      : this.parentNode?.closest(selector) ?? null
  }
  querySelectorAll(selector: string): TElement[] {
    return this.childNodes.filter((n) => n instanceof TElement).flatMap((n) => {
      let el = n as TElement
      return [
        ...el.matches(selector) ? [el] : [],
        ...el.querySelectorAll(selector),
      ]
    })
  }
  querySelector(selector: string): TElement | null {
    return this.querySelectorAll(selector)[0] ?? null
  }
  dispatchEvent(event: Event): boolean {
    return dispatch(this, event)
  }
  private attrs = new Map<string, string>()
  handlers: Map<string, unknown> = new Map()
  listeners: Map<string, Set<EventListener>> = new Map<
    string,
    Set<EventListener>
  >()
  constructor(public localName: string) {
    super()
  }
  /** The first child, or null. */
  get firstChild(): TNode | null {
    return this.childNodes[0] ?? null
  }
  /** Read one attribute; undefined when unset. */
  attr(k: string): string | undefined {
    return this.attrs.get(k)
  }
  /** The class attribute, as Preact names it. */
  get className(): string {
    return this.attrs.get('class') ?? ''
  }
  set className(v: string) {
    this.setAttribute('class', v)
  }
  /** Append a child. */
  appendChild(c: TNode) {
    this.insertBefore(c, null)
  }
  /** Insert a child before `ref`, or at the end when ref is null. */
  insertBefore(c: TNode, ref: TNode | null) {
    c.parentNode?.removeChild(c)
    let i = ref ? this.childNodes.indexOf(ref) : -1
    this.childNodes.splice(i < 0 ? this.childNodes.length : i, 0, c)
    c.parentNode = this
    touch()
  }
  /** Remove a child. */
  removeChild(c: TNode) {
    let i = this.childNodes.indexOf(c)
    if (i >= 0) this.childNodes.splice(i, 1)
    c.parentNode = null
    touch()
  }
  /** Set an attribute; its name lowercased and its value stringified, as an
   * HTML document does (Preact writes `tabIndex`, a selector reads
   * `[tabindex]`). */
  setAttribute(k: string, v: unknown) {
    this.attrs.set(k.toLowerCase(), String(v))
    touch()
  }
  /** Remove an attribute. */
  removeAttribute(k: string) {
    this.attrs.delete(k.toLowerCase())
    touch()
  }
  /** Record a listener. Pointer events bubble here; keys go through `screen`. */
  addEventListener(t: string, fn: unknown) {
    let set = this.listeners.get(t) ?? new Set<EventListener>()
    set.add(fn as EventListener)
    this.listeners.set(t, set)
    this.handlers.set(t, (e: Event) => {
      let consumed = false
      for (let handler of [...this.listeners.get(t) ?? []].reverse()) {
        if (
          (handler as unknown as (e: Event) => unknown).call(this, e) === true
        ) consumed = true
        if (e.cancelBubble) break
      }
      return consumed
    })
  }
  /** Forget a listener. */
  removeEventListener(t: string, fn?: unknown) {
    if (fn) this.listeners.get(t)?.delete(fn as EventListener)
    else this.listeners.delete(t)
    if (!this.listeners.get(t)?.size) this.handlers.delete(t)
  }
}

/** Deliver DOM events through capture, target, bubble and the host window. */
export let dispatch = (target: TElement, event: Event): boolean => {
  Object.defineProperty(event, 'target', { value: target, configurable: true })
  let path: TElement[] = []
  for (let n: TElement | null = target; n; n = n.parentNode) path.push(n)
  let call = (node: TElement, capture = false) => {
    Object.defineProperty(event, 'currentTarget', {
      value: node,
      configurable: true,
    })
    let handler = node.handlers.get(event.type + (capture ? 'Capture' : ''))
    if (typeof handler == 'function') handler.call(node, event)
  }
  for (let n of [...path].reverse()) {
    call(n, true)
    if (event.cancelBubble) return !event.defaultPrevented
  }
  for (let n of path) {
    call(n)
    if (event.cancelBubble) return !event.defaultPrevented
  }
  Object.defineProperty(event, 'currentTarget', {
    value: null,
    configurable: true,
  })
  globalThis.dispatchEvent(event)
  return !event.defaultPrevented
}

/** The document Preact reaches for globally, over these node types. */
export let doc: {
  createElement: (t: string) => TElement
  createElementNS: (ns: string, t: string) => TElement
  createTextNode: (d: string) => TText
  activeElement: TElement | null
  addEventListener: typeof globalThis.addEventListener
  removeEventListener: typeof globalThis.removeEventListener
  getSelection: () => null
  querySelector: (s: string) => null
} = {
  createElement: (t: string): TElement => new TElement(t),
  createElementNS: (_ns: string, t: string): TElement => new TElement(t),
  createTextNode: (d: string): TText => new TText(d),
  activeElement: null as TElement | null,
  addEventListener: globalThis.addEventListener.bind(globalThis),
  removeEventListener: globalThis.removeEventListener.bind(globalThis),
  getSelection: () => null,
  querySelector: (_s: string) => null,
}

/** Install that document, returning a fresh render root and the restore. */
export let install = (): { root: TElement; free: () => void } => {
  let priorElement = Object.getOwnPropertyDescriptor(globalThis, 'Element')
  let priorHtml = Object.getOwnPropertyDescriptor(globalThis, 'HTMLElement')
  Object.defineProperty(globalThis, 'Element', {
    value: TElement,
    configurable: true,
  })
  Object.defineProperty(globalThis, 'HTMLElement', {
    value: TElement,
    configurable: true,
  })
  let prior = Object.getOwnPropertyDescriptor(globalThis, 'document')
  Object.defineProperty(globalThis, 'document', {
    value: doc,
    configurable: true,
  })
  return {
    root: new TElement('root'),
    free: () => {
      for (
        let [name, descriptor] of [['Element', priorElement], [
          'HTMLElement',
          priorHtml,
        ]] as const
      ) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor)
        else Reflect.deleteProperty(globalThis, name)
      }
      if (prior) Object.defineProperty(globalThis, 'document', prior)
      else delete (globalThis as { document?: unknown }).document
    },
  }
}
