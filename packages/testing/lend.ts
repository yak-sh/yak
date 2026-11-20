// A global a test sets for a while, such as `document` for a page it draws,
// and puts back. Files run in one runtime, so whatever is there may be
// another module's: the terminal's document is installed read-only as its
// module loads (@yaks/browse/tui/doc), and a plain assignment over it throws.

/**
 * Lend `globalThis[name]` the value `value`, over whatever is there, read-only
 * or not; the call it returns puts back what was there, or removes the name
 * where nothing was.
 *
 * ```ts
 * import { equal, lend } from '@yaks/testing'
 *
 * let back = lend('lent', 1)
 * equal((globalThis as { lent?: number }).lent, 1)
 * back()
 * equal('lent' in globalThis, false)
 * ```
 */
export let lend = (name: string, value: unknown): () => void => {
  let prior = Object.getOwnPropertyDescriptor(globalThis, name)
  Object.defineProperty(globalThis, name, {
    value,
    configurable: true,
    writable: true,
  })
  return () => {
    if (prior) Object.defineProperty(globalThis, name, prior)
    else Reflect.deleteProperty(globalThis, name)
  }
}
