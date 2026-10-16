// The inbox opens source entities rather than pretending they are all conversations.
import { inbox, resultUrl } from './client'
import { Results } from './results'
import { useLoad } from './ui-hooks'

export default function Inbox() {
  return <Results title='Inbox' {...useLoad(inbox)} resultUrl={resultUrl} />
}
