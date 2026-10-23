// What a tool does, whole: its description, lowered from Markdown to the
// caller's structural elements, the body of its page. Loaded only where one
// is drawn (./views.ts), so a reader that never draws one never loads the
// parser.
import { parse, render } from '@yaks/markdown/structural'
import type { Rendering } from '@yaks/render'

export let body: Rendering = (b, h) => {
  let said = (b.tool as Record<string, unknown> | undefined)?.description
  return h(
    'div',
    { class: 'Md' },
    render(parse(typeof said == 'string' ? said : '', { breaks: false }), h),
  )
}
