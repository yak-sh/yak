// React loading boundaries ignore stale responses after navigation or input changes.
import { LocalStorage } from '@raycast/api'
import { useCallback, useEffect, useState } from 'react'
import { projects } from './client'
import { errorText, selectedProject } from './ui-state'

export const projectStorageKey = 'yak.selected-project'

export function useLoad<T>(load: () => Promise<T>) {
  const [value, setValue] = useState<T>()
  const [error, setError] = useState<string>()
  const [loading, setLoading] = useState(true)
  const [revision, setRevision] = useState(0)
  const reload = useCallback(() => setRevision((value) => value + 1), [])
  useEffect(() => {
    let active = true
    setLoading(true)
    setError(undefined)
    setValue(undefined)
    void load()
      .then((value) => {
        if (active) setValue(value)
      })
      .catch((error: unknown) => {
        if (active) setError(errorText(error))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [load, revision])
  return { value, error, loading, reload }
}

export function useProjects() {
  const load = useCallback(async () => {
    const [items, remembered] = await Promise.all([
      projects(),
      LocalStorage.getItem<string>(projectStorageKey),
    ])
    return { items, selected: selectedProject(items, remembered) }
  }, [])
  const state = useLoad(load)
  const [selection, setSelection] = useState<string>()
  const [storageError, setStorageError] = useState<string>()
  const project = state.value
    ? selectedProject(state.value.items, selection ?? state.value.selected)
    : ''
  const choose = (id: string) => {
    setSelection(id)
    setStorageError(undefined)
    void LocalStorage.setItem(projectStorageKey, id).catch((error: unknown) => {
      setStorageError(`Could not remember project: ${errorText(error)}`)
    })
  }
  return { ...state, project, choose, storageError }
}
