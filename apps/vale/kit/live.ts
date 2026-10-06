/** A value a part shows, or a signal of it: given the signal, the part's
 * element follows it without the part being drawn again. */
import { type ReadonlySignal, Signal } from '@preact/signals'

export type Live<T> = T | ReadonlySignal<T>

/** What `v` holds now; read inside a computed, it follows `v`. */
export let read = <T>(v: Live<T>): T => v instanceof Signal ? v.value : v as T
