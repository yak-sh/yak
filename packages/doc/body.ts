// A document body lowers Markdown to the caller's structural elements.
import { parse, render } from '@yaks/markdown/structural'
import type { Rendering } from '@yaks/render'
import { BODY, DOC } from './comp.ts'

export let body: Rendering = (b, h) => {
  let value = (b[DOC] as Record<string, unknown> | undefined)?.[BODY]
  return h(
    'div',
    { class: 'Md' },
    render(
      parse(
        typeof value == 'string' ? value : '',
        { breaks: false },
      ),
      h,
    ),
  )
}
