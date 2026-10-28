import type { ComponentChildren } from 'preact'
import { useErrorBoundary } from 'preact/hooks'
import { block } from '@yaks/ui'
import { failure } from '../failure.ts'
import { problem } from '../live.ts'

let Face = block('section', 'Fault', { Retry: 'button' })
let said = (error: unknown) =>
  error instanceof Error ? error.message : String(error)

export let Fault = ({ place, children }: {
  place: string
  children: ComponentChildren
}) => {
  let [error, retry] = useErrorBoundary((error) => {
    failure(error, place)
    problem.value = `a view could not be drawn: ${said(error)}`
  })
  return error
    ? (
      <Face>
        {place} could not be drawn: {said(error)}
        <Face.Retry type='button' onClick={retry}>retry</Face.Retry>
      </Face>
    )
    : <>{children}</>
}
