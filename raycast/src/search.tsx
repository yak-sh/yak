// Search the whole graph without a project restriction.
import { useCallback, useState } from 'react'
import { resultUrl, search } from './client'
import { Results } from './results'
import { useLoad } from './ui-hooks'

export default function Search() {
  const [query, setQuery] = useState('')
  const load = useCallback(
    () => (query.trim() ? search(query) : Promise.resolve([])),
    [query],
  )
  const state = useLoad(load)
  return (
    <Results
      title='Search Graph'
      {...state}
      resultUrl={resultUrl}
      query={query}
      onSearchTextChange={setQuery}
    />
  )
}
