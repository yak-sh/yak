// View state belongs to the page's graph. Stable places survive remounts;
// subscriptions last only as long as the parts that read them.
import { signal } from '@preact/signals'
import { derivedEid } from '@yaks/graph'
import { useLayoutEffect, useMemo } from 'preact/hooks'
import { front } from './fields.tsx'

export let usePage = <T extends Record<string, unknown>>(
  name: string,
  place: string,
) => {
  let eid = derivedEid(`${name}|${place}`)
  let held = useMemo(() => {
    let watch = front.watch(`.${name} .entity.eid=${eid}`)
    let rows = signal(watch.value)
    let off = watch.subscribe((rowsNow) => rows.value = rowsNow)
    return {
      rows,
      free() {
        off()
        watch.close()
      },
    }
  }, [name, eid])
  useLayoutEffect(() => held.free, [held])
  return {
    value: held.rows.value[0]?.[name] as T | undefined,
    set: (value: Partial<T>) =>
      void front.mutate([{ entity: { eid }, [name]: value }]),
  }
}
