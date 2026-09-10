// Observers belong to the outermost successful transaction. A released
// savepoint joins its parent's queue; rollback discards only its own callbacks.
export class Commits {
  #stack: (() => void)[][] = []

  after(run: () => void): void {
    let queue = this.#stack.at(-1)
    if (queue) queue.push(run)
    else run()
  }

  run<T>(body: () => T): T {
    let queue: (() => void)[] = []
    this.#stack.push(queue)
    let value: T
    try {
      value = body()
    } catch (err) {
      this.#stack.pop()
      throw err
    }
    this.#stack.pop()
    // Delivery is OUTSIDE the rollback catch: a callback failure cannot
    // retroactively roll back a committed database.
    for (let run of queue) this.after(run)
    return value
  }
}
