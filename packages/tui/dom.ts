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
  focus() {
    doc.activeElement = this
    this.dispatchEvent(new Event('focus'))
  }
  blur() {
    if (doc.activeElement == this) doc.activeElement = null
    this.dispatchEvent(new Event('blur'))
  }
  setSelectionRange(start: number, end: number) {
    this.selectionStart = start
    this.selectionEnd = end
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
    return this.attr(k) ?? null
  }
  hasAttribute(k: string): boolean {
    return this.attr(k) != null
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
  /** Set an attribute; values are stringified, as the DOM does. */
  setAttribute(k: string, v: unknown) {
    this.attrs.set(k, String(v))
    touch()
  }
  /** Remove an attribute. */
  removeAttribute(k: string) {
    this.attrs.delete(k)
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
