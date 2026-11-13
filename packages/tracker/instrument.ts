/**
 * `@yaks/tracker/instrument` — a class whose every call runs inside a
 * reporting boundary: its construction, and each method of its prototype,
 * lifecycle callbacks and RPC alike. The boundary is given, so the class's
 * failures are reported wherever the caller's tracker reports them, and a
 * callback installed by construction keeps the invocation it was made in.
 *
 * ```ts
 * import { instrument } from '@yaks/tracker/instrument'
 * import { assertEquals } from '@std/assert'
 *
 * let entered: string[] = []
 * class Shop {
 *   sell() {
 *     return 'sold'
 *   }
 * }
 * let Tracked = instrument(Shop, (_args, name, run) => {
 *   entered.push(name)
 *   return run()
 * })
 * assertEquals(new Tracked().sell(), 'sold')
 * assertEquals(entered, ['Shop constructor', 'Shop sell'])
 * ```
 *
 * @module
 */

/** The boundary a call enters: the arguments its object was constructed
 * with (a Durable Object's state and env), its name as `<Class> <method>`,
 * the call, and the request it was handed, if any. It answers what the call
 * answers. */
export type Enter = <T>(
  args: unknown[],
  name: string,
  run: () => T,
  request?: Request,
) => T

type Method = (...args: unknown[]) => unknown

/** Each method an object of a class answers, its own and those it inherits,
 * by the nearest definition: everything short of `Object`'s own. */
export let methods = (prototype: object): [string, Method][] => {
  let found = new Map<string, Method>()
  for (
    let at = prototype;
    at && at != Object.prototype;
    at = Object.getPrototypeOf(at)
  ) {
    for (let name of Object.getOwnPropertyNames(at)) {
      let value = Object.getOwnPropertyDescriptor(at, name)?.value
      if (name == 'constructor' || found.has(name)) continue
      if (typeof value == 'function') found.set(name, value)
    }
  }
  return [...found]
}

/** `Original`, with its construction and each of its prototype's methods run
 * inside `enter`. `making`, when given, is told each construction's
 * arguments and the class's name before the object is made. */
export let instrument = <C>(
  Original: C,
  enter: Enter,
  making?: (args: unknown[], name: string) => void,
): C => {
  let Base = Original as unknown as new (...args: unknown[]) => object
  let made = new WeakMap<object, unknown[]>()
  class Tracked extends Base {}
  for (let [method, run] of methods(Base.prototype)) {
    Object.defineProperty(Tracked.prototype, method, {
      value(this: object, ...args: unknown[]) {
        return enter(
          made.get(this) ?? [],
          `${Base.name} ${method}`,
          () => Reflect.apply(run, this, args),
          args.find((arg): arg is Request => arg instanceof Request),
        )
      },
    })
  }
  return new Proxy(Tracked, {
    construct(target, args, newTarget) {
      making?.(args, Base.name)
      return enter(args, `${Base.name} constructor`, () => {
        let object = Reflect.construct(target, args, newTarget)
        made.set(object, args)
        return object
      })
    },
  }) as unknown as C
}
