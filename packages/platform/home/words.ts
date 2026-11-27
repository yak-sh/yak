import type { ReactElement } from 'react'

export type Copy = {
  text: (key: string, slots?: Record<string, ReactElement>) => {
    children: (ReactElement | string)[]
  }
  attr: <Name extends string>(name: Name, key: string) => Record<Name, string>
}
