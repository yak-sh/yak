import type { VNode } from 'preact'

export type Copy = {
  text: (key: string, slots?: Record<string, VNode>) => {
    children: (VNode | string)[]
  }
  attr: <Name extends string>(name: Name, key: string) => Record<Name, string>
}
