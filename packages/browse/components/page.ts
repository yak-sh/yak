// View state belongs to the page's graph. Stable places survive remounts;
// subscriptions last only as long as the parts that read them.
import { useRows } from '@yaks/ux'
import { derivedEid } from '@yaks/graph/identity'
import { front } from './fields.tsx'

export let usePage = <T extends Record<string, unknown>>(
  name: string,
  place: string,
) => {
  let eid = derivedEid(`${name}|${place}`)
  let [row] = useRows(front, `.${name} .entity.eid=${eid}`)
  return {
    value: row?.[name] as T | undefined,
    set: (value: Partial<T>) =>
      void front.mutate([{ entity: { eid }, [name]: value }]),
  }
}
