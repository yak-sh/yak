import {
  fallbackName,
  keepName as keep,
  type NameSource,
  suppliedName,
} from '@yaks/platform/named'
import { KERNEL, type Meta } from './meta.ts'

export { suppliedName as chose }

/** What to call someone in an app or on a page. */
export let nameOf = (title: string | null | undefined, email: string) =>
  suppliedName(title) ?? fallbackName(email)

/** Keep a name through the kernel's directory. */
export let keepName = (
  store: Meta,
  person: string,
  name: string | null,
  source: NameSource,
  options?: Parameters<typeof keep>[4],
) =>
  keep(
    {
      read: (q) => store.query(q as never),
      apply: (bundles) => store.apply(bundles, KERNEL),
    },
    person,
    name,
    source,
    options,
  )
