/** Hand the deferred reporter the errors raised while the parser is running.
 * The window slot is cleared when the full reporter takes over. */
export let EARLY_REPORT = `(() => {
  let key = Symbol.for('yaks.early-report')
  let pending = []
  let hold = (event) => { if (pending.length < 20) pending.push(event) }
  addEventListener('error', hold, true)
  addEventListener('unhandledrejection', hold)
  globalThis[key] = () => {
    removeEventListener('error', hold, true)
    removeEventListener('unhandledrejection', hold)
    delete globalThis[key]
    return pending
  }
})()`
