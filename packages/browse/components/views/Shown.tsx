/** @jsxImportSource preact */
// What a decision's choice shows, drawn by what it is: an image as itself
// with its address under it (the address is what a terminal shows), prose as
// its title over its Markdown, a page framed at desktop or phone width.
import { type Ent } from '../../types.ts'
import { ent } from '../../live.ts'
import { Markdown } from '@yaks/markdown'
import { Body, Check, Doc, Preview } from '@yaks/ui'
import { Media } from './Media.tsx'

export let ShownImage = ({ e }: { e: Ent }) => {
  let address = e.attachment
    ? ent(e.attachment.artifact).artifact?.address ?? e.attachment.artifact
    : e.artifact?.address
  return (
    <>
      <Media e={e} />
      <Preview.Address href={`/blob/${address}`}>
        {e.attachment?.name ?? `/blob/${address}`}
      </Preview.Address>
    </>
  )
}

export let ShownProse = ({ e }: { e: Ent }) => (
  <Doc>
    {e.doc?.title && <Doc.Title>{e.doc.title}</Doc.Title>}
    {e.doc?.body && (
      <Body>
        <Markdown source={e.doc.body} />
      </Body>
    )}
  </Doc>
)

// A page runs its scripts in an opaque origin, walled off from this one.
let views = [['Desktop', 'desktop'], ['Phone', 'phone']] as const

export let ShownPage = ({ e }: { e: Ent }) => {
  let url = String(e.web?.url ?? '')
  return (
    <Preview>
      <Preview.Address href={url} target='_blank' rel='noopener'>
        {url}
      </Preview.Address>
      <Preview.Choices role='radiogroup' aria-label='Page width'>
        {views.map(([title, width], i) => (
          <Preview.Item key={width}>
            <Preview.Choice>
              <Check.Input
                type='radio'
                name={`shown-${e.eid}`}
                value={width}
                checked={i == 0}
              />
              {title}
            </Preview.Choice>
            <Preview.View>
              <Preview.Frame
                mod={width}
                title={`${e.doc?.title ?? url}, ${width} width`}
                src={url}
                sandbox='allow-scripts allow-forms'
                loading='lazy'
              />
            </Preview.View>
          </Preview.Item>
        ))}
      </Preview.Choices>
    </Preview>
  )
}
