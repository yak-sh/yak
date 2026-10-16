// Recent conversations reopen the same session in its selected project.
import { Action, ActionPanel, Icon, Keyboard, List } from '@raycast/api'
import { Conversation } from './conversation'

export function ConversationList({
  project,
  value,
  error,
  loading,
  reload,
}: {
  project: string
  value?: Array<{ id: string; title: string; status?: string }>
  error?: string
  loading: boolean
  reload: () => void
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
      navigationTitle='Recent Conversations'
      isLoading={loading}
      searchBarPlaceholder='Find a conversation…'
      actions={<ActionPanel>{refresh}</ActionPanel>}
    >
      {error && (
        <List.Item
          title='Could Not Load Conversations'
          subtitle={error}
          icon={Icon.ExclamationMark}
          actions={<ActionPanel>{refresh}</ActionPanel>}
        />
      )}
      {!error && !loading && !value?.length && (
        <List.EmptyView
          title='No Conversations Yet'
          description='Go back and send a message to start talking.'
        />
      )}
      {(value ?? []).map((item) => (
        <List.Item
          key={item.id}
          title={item.title || item.id}
          accessories={item.status ? [{ text: item.status }] : []}
          icon={Icon.Message}
          actions={
            <ActionPanel>
              <Action.Push
                title='Open Conversation'
                target={
                  <Conversation
                    id={item.id}
                    title={item.title}
                    project={project}
                  />
                }
              />
              {refresh}
            </ActionPanel>
          }
        />
      ))}
    </List>
  )
}
