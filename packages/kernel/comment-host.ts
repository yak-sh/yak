// The doors comments need from whichever interface mounts them. The domain
// owns comment bundles; a host owns subscriptions, navigation and rendering.
import type { Bundle } from '@yaks/graph'
import type { ComponentChildren } from 'preact'

export type CommentHost = {
  get: (eid: string) => Bundle
  id: (b: Bundle) => string
  useRows: (query: string) => Bundle[]
  useModel: (eid: string) => string | undefined
  useRepo: (b: Bundle) => string | undefined
  usePage: (name: string, place: string) => {
    value?: Record<string, unknown>
    set: (value: Record<string, unknown>) => void
  }
  render: (b: Bundle, view: string) => ComponentChildren
  link: (b: Bundle) => Record<string, unknown>
  markdown: (text: string, repo?: string) => ComponentChildren
  pending: (b: Bundle) => boolean
  has: (comp: string) => boolean
  modelName: (model?: string) => string | undefined
  when: (at?: string) => string
  timestamp: (at?: string) => string
  command: (line: string) => boolean
  hints: (line: string) => { name: string; args: string; about: string }[]
}
let current: CommentHost | undefined
/** Bind the domain to an interface before mounting its views. */
export let configureComments = (host: CommentHost): void => {
  current = host
}
export let commentHost = (): CommentHost => {
  if (!current) throw new Error('Comments need an interface host')
  return current
}
