// A class the runtime constructs at once whose object is made on its first
// call, from a module loaded then. A module is evaluated when it is first
// imported, so an isolate that wakes one Durable Object evaluates that
// object's code and not the router's, and one that answers a page none of
// the object's own.

/** What makes the object a deferred class answers through, from the
 * arguments the runtime constructed the class with (its state or context,
 * and its bindings). A class is one: `(...args) => new C(...args)`. */
export type Made = (...args: never[]) => object

/** How each call is run: around the deferred object's own answer, given the
 * constructor's arguments, the method's name and its arguments. */
export type Around = (
  args: unknown[],
  method: string,
  call: () => Promise<unknown>,
  given: unknown[],
) => Promise<unknown>

type Answering = Record<string, (...args: unknown[]) => unknown>

/** `Base` with `methods`, each of which loads what `load` gives, makes one
 * object with it from the constructor's arguments, and answers through it.
 * A load that fails is tried again by the next call, and so is a factory
 * that throws. `around`, when given, runs each call. */
export let deferred = (
  Base: new (...args: never[]) => object,
  load: () => Promise<Made>,
  methods: readonly string[],
  around?: Around,
): new (...args: unknown[]) => object => {
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
      held = loaded().then((make) =>
        (make as (...a: unknown[]) => object)(...args.get(self)!) as Answering
      )
      held.catch(() => made.delete(self))
      made.set(self, held)
    }
    return held
  }
  for (let method of methods) {
    Object.defineProperty(Lazy.prototype, method, {
      value(this: object, ...given: unknown[]) {
        let call = async () => (await object(this))[method](...given)
        return around ? around(args.get(this)!, method, call, given) : call()
      },
    })
  }
  return Lazy
}
