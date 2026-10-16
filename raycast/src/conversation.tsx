// A conversation stays visible as replies arrive; a focused composer sends follow-ups.
import {
  Action,
  ActionPanel,
  Detail,
  Form,
  Icon,
  Keyboard,
  useNavigation,
} from '@raycast/api'
import { useEffect, useRef, useState } from 'react'
import { conversation, resultUrl, send } from './client'
import {
  type Conversation as ConversationData,
  errorText,
  mergeConversation,
  poll,
  submissionGate,
  transcript,
} from './ui-state'

export function Conversation({
  id,
  project,
  title,
  initialText,
}: {
  id: string
  project: string
  title?: string
  initialText?: string
}) {
  const [value, setValue] = useState<ConversationData>()
  const [error, setError] = useState<string>()
  const [revision, setRevision] = useState(0)
  const [olderLoading, setOlderLoading] = useState(false)
  const olderGate = useRef(submissionGate())
  const active = useRef(true)
  useEffect(() => {
    active.current = true
    return () => {
      active.current = false
    }
  }, [])
  const { push } = useNavigation()
  useEffect(
    () =>
      poll(
        () => conversation(id, project),
        (value) => {
          setValue((current) => mergeConversation(current, value, 'tail'))
          setError(undefined)
        },
        (error) => setError(errorText(error)),
      ),
    [id, project, revision],
  )
  const provisional: ConversationData = {
    id,
    before: false,
    nextBefore: null,
    status: 'Waiting for reply',
    messages: initialText
      ? [{ id: 'initial', role: 'user', text: initialText }]
      : [],
  }
  async function loadOlder() {
    if (value?.nextBefore == null) return
    const before = value.nextBefore
    await olderGate.current(async () => {
      setOlderLoading(true)
      try {
        const page = await conversation(id, project, before)
        if (active.current) {
          setValue((current) => mergeConversation(current, page, 'older'))
          setError(undefined)
        }
      } catch (error) {
        if (active.current) setError(errorText(error))
      } finally {
        if (active.current) setOlderLoading(false)
      }
    })
  }
  return (
    <Detail
      navigationTitle={title || 'Conversation'}
      isLoading={olderLoading || (!value && !error)}
      markdown={`${
        error
          ? `**Could not refresh conversation**\n\n${errorText(
              error,
            )}\n\n---\n\n`
          : ''
      }${transcript(value ?? provisional)}`}
      actions={
        <ActionPanel>
          <Action
            title='Reply'
            icon={Icon.Message}
            onAction={() =>
              push(
                <Reply
                  id={id}
                  project={project}
                  onSent={() => setRevision((value) => value + 1)}
                />,
              )
            }
          />
          <Action
            title='Refresh Conversation'
            icon={Icon.ArrowClockwise}
            shortcut={Keyboard.Shortcut.Common.Refresh}
            onAction={() => setRevision((value) => value + 1)}
          />
          {value?.nextBefore != null && (
            <Action
              title={olderLoading ? 'Loading Older…' : 'Load Older Messages'}
              icon={Icon.Clock}
              shortcut={{ modifiers: ['cmd', 'shift'], key: 'l' }}
              onAction={loadOlder}
            />
          )}
          <Action.OpenInBrowser url={resultUrl(id)} />
        </ActionPanel>
      }
    />
  )
}

function Reply({
  id,
  project,
  onSent,
}: {
  id: string
  project: string
  onSent: () => void
}) {
  const [text, setText] = useState('')
  const [error, setError] = useState<string>()
  const [sending, setSending] = useState(false)
  const gate = useRef(submissionGate())
  const { pop } = useNavigation()
  async function submit() {
    if (!text.trim()) {
      setError('Write a message first.')
      return
    }
    await gate.current(async () => {
      setSending(true)
      setError(undefined)
      try {
        await send(id, text, project)
        onSent()
        pop()
      } catch (error) {
        setError(errorText(error))
      } finally {
        setSending(false)
      }
    })
  }
  return (
    <Form
      navigationTitle='Reply to Yak'
      isLoading={sending}
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title={sending ? 'Sending…' : 'Send Reply'}
            onSubmit={submit}
          />
        </ActionPanel>
      }
    >
      <Form.TextArea
        id='text'
        title='Message'
        autoFocus
        value={text}
        onChange={(text) => {
          setText(text)
          setError(undefined)
        }}
        placeholder='Keep talking…'
      />
      {error && <Form.Description title='Could Not Send' text={error} />}
    </Form>
  )
}
