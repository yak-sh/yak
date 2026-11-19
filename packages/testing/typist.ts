/**
 * A text field kept the way a browser keeps one, on a DOM that keeps none
 * (linkedom): a value a script puts in moves the caret to the end, and a
 * person's typing goes in at the caret, replacing what is selected, and fires
 * `input`. A bug that moves the caret shows here as it does in a browser.
 *
 * ```ts ignore
 * let t = typist(textarea)
 * t.at(4)
 * t.type(' me')
 * equal([textarea.value, textarea.selectionStart], ['Find me the recipe', 7])
 * ```
 *
 * @module
 */

type Typed = HTMLInputElement | HTMLTextAreaElement

/** A person at a field. */
export type Typist = {
  /** put the caret at `a`, or select from `a` to `b` */
  at: (a: number, b?: number) => void
  /** type `typed` at the caret, a character at a time */
  type: (typed: string) => void
  /** type `typed` at once as an input method composes it */
  compose: (typed: string) => void
  /** end the composition */
  end: () => void
}

/** A person at `el`: `at` puts the caret (or selects to `to`), `type` types
 * at it, and `compose` types as an input method does, `end` closing it. */
export let typist = (el: Typed): Typist => {
  let text = el.value
  let from = text.length, to = text.length
  Object.defineProperties(el, {
    value: {
      configurable: true,
      get: () => text,
      set: (v: string) => {
        text = String(v).replace(/\r\n?/g, '\n')
        from = to = text.length
      },
    },
    selectionStart: { configurable: true, get: () => from },
    selectionEnd: { configurable: true, get: () => to },
    selectionDirection: { configurable: true, get: () => 'none' },
    setSelectionRange: {
      configurable: true,
      value: (a: number, b: number) => {
        from = a
        to = b
      },
    },
  })
  let fire = (type: string) => {
    let E = el.ownerDocument.defaultView?.Event ?? Event
    el.dispatchEvent(new E(type, { bubbles: true }))
  }
  let put = (typed: string) => {
    text = text.slice(0, from) + typed + text.slice(to)
    from = to = from + typed.length
    fire('input')
  }
  return {
    at: (a: number, b = a) => {
      from = a
      to = b
    },
    type: (typed: string) => {
      for (let c of typed) put(c)
    },
    compose: (typed: string) => {
      fire('compositionstart')
      put(typed)
    },
    end: () => fire('compositionend'),
  }
}
