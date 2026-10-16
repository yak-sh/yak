// Graph results keep their body visible and open the source entity in the browser.
import { Action, ActionPanel, Icon, Keyboard, List } from '@raycast/api'

export type Result = { id: string; title: string; body?: string }
export function Results({
  title,
  value,
  error,
  loading,
  reload,
  resultUrl,
  onSearchTextChange,
  query,
}: {
  title: string
  value?: Result[]
  error?: string
  loading: boolean
  reload: () => void
  resultUrl: (id: string) => string
  onSearchTextChange?: (text: string) => void
  query?: string
}) {
  const refresh = (
    <Action
      title='Refresh'
      icon={Icon.ArrowClockwise}
      shortcut={Keyboard.Shortcut.Common.Refresh}
      onAction={reload}
    />
  )
  return (
    <List
      navigationTitle={title}
      isLoading={loading}
      filtering={!onSearchTextChange}
      onSearchTextChange={onSearchTextChange}
      searchText={query}
      throttle
      searchBarPlaceholder={
        onSearchTextChange ? 'Search anything in your graph…' : 'Filter inbox…'
      }
      isShowingDetail
      actions={<ActionPanel>{refresh}</ActionPanel>}
    >
      {error && (
        <List.Item
          title={`Could Not Load ${title}`}
          subtitle={error}
          icon={Icon.ExclamationMark}
          detail={<List.Item.Detail markdown={error} />}
          actions={<ActionPanel>{refresh}</ActionPanel>}
        />
      )}
      {!loading && !error && !value?.length && (
        <List.EmptyView
          title={
            onSearchTextChange && !query?.trim()
              ? 'Search Your Graph'
              : 'No Results'
          }
          description={
            onSearchTextChange
              ? 'Search people, projects, conversations, work, or anything else.'
              : 'Your inbox is empty.'
          }
        />
      )}
      {(value ?? []).map((item) => (
        <List.Item
          key={item.id}
          title={item.title || item.id}
          icon={Icon.Document}
          detail={
            <List.Item.Detail markdown={item.body || item.title || item.id} />
          }
          actions={
            <ActionPanel>
              <Action.OpenInBrowser url={resultUrl(item.id)} />
              <Action.CopyToClipboard title='Copy ID' content={item.id} />
              {refresh}
            </ActionPanel>
          }
        />
      ))}
    </List>
  )
}
