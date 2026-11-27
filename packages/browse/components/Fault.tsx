/** @jsxImportSource react */
import { Component, type ReactNode } from 'react'
import { block } from '@yaks/ui'
import { failure } from '../failure.ts'
import { problem } from '../live.ts'

let Face = block('section', 'Fault', { Retry: 'button' })
let said = (error: unknown) =>
  error instanceof Error ? error.message : String(error)

type Props = { place: string; children?: ReactNode }
type State = { failure?: { error: unknown } }

/** Let the rest of the page draw if an individual view throws. */
export class Fault extends Component<Props, State> {
  override state: State = {}

  static override getDerivedStateFromError(error: unknown): State {
    return { failure: { error } }
  }

  override componentDidCatch(error: unknown): void {
    failure(error, this.props.place)
    problem.value = `a view could not be drawn: ${said(error)}`
  }

  override render(): ReactNode {
    let caught = this.state.failure
    return caught
      ? (
        <Face>
          {this.props.place} could not be drawn: {said(caught.error)}
          <Face.Retry
            type='button'
            onClick={() => this.setState({ failure: undefined })}
          >
            retry
          </Face.Retry>
        </Face>
      )
      : this.props.children
  }
}
