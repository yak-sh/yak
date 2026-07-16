// A just-enough DOM for preact to render against outside a browser (the
// undom trick): elements are plain objects, every mutation marks the tree
// dirty, and whoever owns the screen paints on the next microtask.
// Importing this module installs globalThis.document — import it before
// anything renders.

let paint = { fn: () => {} }
export let onPaint = (fn: () => void) => paint.fn = fn

let dirty = false
let touch = () => {
  if (dirty) return
  dirty = true
  queueMicrotask(() => {
    dirty = false
    paint.fn()
  })
}

export class TNode {
  parentNode: TElement | null = null
  get nextSibling(): TNode | null {
    let sibs = this.parentNode?.childNodes
    return sibs ? sibs[sibs.indexOf(this) + 1] ?? null : null
  }
  remove() {
    this.parentNode?.removeChild(this)
  }
}

export class TText extends TNode {
  nodeType = 3
  private text: string
  constructor(text: unknown) { // preact passes numbers through raw
    super()
    this.text = String(text)
  }
  get data(): string {
    return this.text
  }
  set data(v: string) {
    this.text = String(v)
    touch()
  }
}

export class TElement extends TNode {
  nodeType = 1
  childNodes: TNode[] = []
  style: Record<string, unknown> = {}
  private attrs = new Map<string, string>()
  private handlers = new Map<string, unknown>()
  constructor(public localName: string) {
    super()
  }
  get firstChild(): TNode | null {
    return this.childNodes[0] ?? null
  }
  attr(k: string): string | undefined {
    return this.attrs.get(k)
  }
  get className(): string {
    return this.attrs.get('class') ?? ''
  }
  set className(v: string) {
    this.setAttribute('class', v)
  }
  appendChild(c: TNode) {
    this.insertBefore(c, null)
  }
  insertBefore(c: TNode, ref: TNode | null) {
    c.parentNode?.removeChild(c)
    let i = ref ? this.childNodes.indexOf(ref) : -1
    this.childNodes.splice(i < 0 ? this.childNodes.length : i, 0, c)
    c.parentNode = this
    touch()
  }
  removeChild(c: TNode) {
    let i = this.childNodes.indexOf(c)
    if (i >= 0) this.childNodes.splice(i, 1)
    c.parentNode = null
    touch()
  }
  setAttribute(k: string, v: unknown) {
    this.attrs.set(k, String(v))
    touch()
  }
  removeAttribute(k: string) {
    this.attrs.delete(k)
    touch()
  }
  addEventListener(t: string, fn: unknown) {
    this.handlers.set(t, fn)
  }
  removeEventListener(t: string) {
    this.handlers.delete(t)
  }
}

// The render root, and the document preact reaches for globally.
export let root = new TElement('root')
;(globalThis as { document?: unknown }).document = {
  createElement: (t: string) => new TElement(t),
  createElementNS: (_ns: string, t: string) => new TElement(t),
  createTextNode: (d: string) => new TText(d),
  activeElement: null,
}
