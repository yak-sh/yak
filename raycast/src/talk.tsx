// Talk is the main entry to the system: send and stay, or send and leave after acknowledgment.
import {
  Action,
  ActionPanel,
  closeMainWindow,
  Form,
  Icon,
  Keyboard,
  useNavigation,
} from '@raycast/api'
import { useCallback, useRef, useState } from 'react'
import { drop, recent } from './client'
import { Conversation } from './conversation'
import { useLoad, useProjects } from './ui-hooks'
import { errorText, submissionGate } from './ui-state'
import { ConversationList } from './conversation-list'

export default function Talk() {
  const state = useProjects()
  const { push } = useNavigation()
  const [text, setText] = useState('')
  const [error, setError] = useState<string>()
  const [sending, setSending] = useState(false)
  const gate = useRef(submissionGate())
  async function submit(close: boolean) {
    if (!text.trim()) {
      setError('Write a message first.')
      return
    }
    if (!state.project) {
      setError('Choose a project before sending.')
      return
    }
    const project = state.project
    const message = text
    await gate.current(async () => {
      setSending(true)
      setError(undefined)
      // Remembering is independent of sending. A storage error must not suggest
      // retrying a message that the server already accepted.
      state.choose(project)
      try {
        const result = await drop(message, project)
        setText('')
        if (close) await closeMainWindow()
        else {
          push(
            <Conversation
              id={result.id}
              project={project}
              title={result.title}
              initialText={message}
            />,
          )
        }
      } catch (error) {
        setError(errorText(error))
      } finally {
        setSending(false)
      }
    })
  }
  return (
    <Form
      navigationTitle='Talk to Yak'
      isLoading={state.loading || sending}
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title={sending ? 'Sending…' : 'Send and Stay'}
            onSubmit={() => submit(false)}
          />
          <Action.SubmitForm
            title='Send and Close'
            shortcut={{ modifiers: ['cmd', 'shift'], key: 'return' }}
            onSubmit={() => submit(true)}
          />
          {state.project && (
            <Action.Push
              title='Recent Conversations'
              icon={Icon.Clock}
              shortcut={{ modifiers: ['cmd'], key: 'h' }}
              target={<Recent project={state.project} />}
            />
          )}
          <Action
            title='Reload Projects'
            icon={Icon.ArrowClockwise}
            shortcut={Keyboard.Shortcut.Common.Refresh}
            onAction={state.reload}
          />
        </ActionPanel>
      }
    >
      <Form.TextArea
        id='text'
        title='Message'
        autoFocus
        placeholder='Ask, plan, decide, or tell Yak anything…'
        value={text}
        onChange={(text) => {
          setText(text)
          setError(undefined)
        }}
      />
      <Form.Dropdown
        id='project'
        title='Project'
        value={state.project}
        onChange={state.choose}
      >
        {(state.value?.items ?? []).map((project) => (
          <Form.Dropdown.Item
            key={project.id}
            value={project.id}
            title={project.title}
          />
        ))}
      </Form.Dropdown>
      {!state.loading && !state.error && !state.value?.items.length && (
        <Form.Description
          title='No Projects'
          text='A project is required. Create one in the graph, then reload projects (⌘R).'
        />
      )}
      {(error || state.error || state.storageError) && (
        <Form.Description
          title='Error'
          text={error || state.error || state.storageError || ''}
        />
      )}
      <Form.Description text='⌘↩ sends and stays in the conversation. ⇧⌘↩ sends and closes after acknowledgment. ⌘H reopens recent conversations.' />
    </Form>
  )
}

function Recent({ project }: { project: string }) {
  const load = useCallback(() => recent(project), [project])
  const state = useLoad(load)
  return <ConversationList project={project} {...state} />
}
