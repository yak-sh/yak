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

// Exported because not every change to the SCREEN is a change to the tree: a
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
  /** DOM node type, as Preact expects to read it. */
  nodeType = 1
  /** Children in document order. */
  childNodes: TNode[] = []
  /** Present because Preact writes to it; the painter reads none of it. */
  style: Record<string, unknown> = {}
  private attrs = new Map<string, string>()
  private handlers = new Map<string, unknown>()
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
  /** The class attribute, as Preact spells it. */
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
  /** Record a listener. Nothing dispatches them; keys go through `screen`. */
  addEventListener(t: string, fn: unknown) {
    this.handlers.set(t, fn)
  }
  /** Forget a listener. */
  removeEventListener(t: string) {
    this.handlers.delete(t)
  }
}

/** The document Preact reaches for globally, over these node types. */
export let doc = {
  createElement: (t: string) => new TElement(t),
  createElementNS: (_ns: string, t: string) => new TElement(t),
  createTextNode: (d: string) => new TText(d),
  activeElement: null,
}

/** Install that document, returning a fresh render root and the restore. */
export let install = (): { root: TElement; free: () => void } => {
  let prior = Object.getOwnPropertyDescriptor(globalThis, 'document')
  Object.defineProperty(globalThis, 'document', {
    value: doc,
    configurable: true,
  })
  return {
    root: new TElement('root'),
    free: () => {
      if (prior) Object.defineProperty(globalThis, 'document', prior)
      else delete (globalThis as { document?: unknown }).document
    },
  }
}
