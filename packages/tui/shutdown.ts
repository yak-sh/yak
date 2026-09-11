/** Two-stage shutdown. A second interrupt forces exit; completion wakes readers. */
export let shutdown = (options: {
  drain?: () => Promise<unknown>
  force?: () => void
} = {}) => {
  let finish!: () => void
  let fail!: (reason: unknown) => void
  let done = new Promise<void>((resolve, reject) => {
    finish = resolve
    fail = reject
  })
  let state: 'open' | 'draining' | 'closed' = 'open'
  return {
    done,
    get draining() {
      return state != 'open'
    },
    interrupt() {
      if (state == 'closed') return
      if (state == 'draining') {
        state = 'closed'
        try {
          options.force?.()
          finish()
        } catch (error) {
          fail(error)
        }
        return
      }
      state = 'draining'
      Promise.resolve().then(() => options.drain?.()).then(() => {
        if (state == 'closed') return
        state = 'closed'
        finish()
      }, (error) => {
        if (state == 'closed') return
        state = 'closed'
        fail(error)
      })
    },
  }
}
