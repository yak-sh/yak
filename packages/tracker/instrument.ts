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
  for (let method of Object.getOwnPropertyNames(Base.prototype)) {
    if (method == 'constructor') continue
    let run = Object.getOwnPropertyDescriptor(Base.prototype, method)?.value
    if (typeof run != 'function') continue
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
