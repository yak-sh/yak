// A class the runtime constructs at once whose object is made on its first
// call, from a module loaded then (T-148770). A module is evaluated when it is
// first imported, so an isolate that wakes a Store evaluates the Store's code
// and not the router's, and one that answers a page none of the Store's own.
// The legacy module registry loads them, for a fraction of the new one's CPU
// (wrangler.toml, T-148980).

type Made = new (...args: never[]) => object
type Answering = Record<string, (...args: unknown[]) => unknown>

/** `Base` with `methods`, each of which loads the class `load` gives, makes
 * one object of it from the constructor's arguments, and answers through it.
 * A load that fails is tried again by the next call. */
export let deferred = (
  Base: new (...args: never[]) => object,
  load: () => Promise<Made>,
  methods: readonly string[],
) => {
  let loading: Promise<Made> | undefined
  let loaded = () =>
    loading ??= load().catch((e) => {
      loading = undefined
      throw e
    })
  let args = new WeakMap<object, unknown[]>()
  let made = new WeakMap<object, Promise<Answering>>()
  let Lazy = class extends (Base as new (...args: unknown[]) => object) {
    constructor(...given: unknown[]) {
      super(...given)
      args.set(this, given)
    }
  }
  let object = (self: object) => {
    let held = made.get(self)
    if (!held) {
      held = loaded().then((Real) =>
        Reflect.construct(Real, args.get(self)!) as Answering
      )
      // A constructor that throws is tried again by the next call too.
      held.catch(() => made.delete(self))
      made.set(self, held)
    }
    return held
  }
  for (let method of methods) {
    Object.defineProperty(Lazy.prototype, method, {
      async value(this: object, ...given: unknown[]) {
        let real = await object(this)
        return real[method](...given)
      },
    })
  }
  return Lazy
}
