// The Configuration panel: one provider-neutral face over the server's two
// configuration planes plus the Codex account. Every row is generated from the
// shared catalog (config.ts) — a NON-secret setting shows its effective value
// and which plane answered, and edits it through an ordinary graph write; a
// SECRET shows only its state (configured / missing / unavailable) and its
// backend, never a value, and its input is never prefilled or echoed. The Codex
// login/logout/browser/device ceremony rides along as its own section, reusing
// the account face verbatim (Account.tsx's CodexSection). Drafts live here in
// mounted UI state and nowhere else.
import { signal } from '@preact/signals'
import { useEffect, useRef, useState } from 'preact/hooks'
import { catalog, spec } from '../config.ts'
import type { CredStatus, SettingRow } from '../config_client.ts'
import { type ConfigControl, configControl } from '../config_client.ts'
import { type AccountControl, codexAccount } from '../account_client.ts'
import { CodexSection } from './Account.tsx'
import { block, el } from './ui.tsx'
import { Icon } from './icons.tsx'

export let configOpen = signal(false)
export let openConfig = () => configOpen.value = true
export let dismissConfig = () => configOpen.value = false

let Frame = block(
  'div',
  'Config',
  {
    Box: 'section',
    Head: 'header',
    Title: 'h2',
    Close: 'button',
    Body: 'div',
    Group: 'section',
    GroupTitle: 'h3',
    Row: 'div',
    Label: 'label',
    Help: 'p',
    Field: 'div',
    Source: 'span',
    State: 'span',
    Input: 'input',
    Select: 'select',
    Actions: 'div',
    Action: 'button',
    Error: 'p',
  } as const,
)
let {
  Box,
  Head,
  Title,
  Close,
  Body,
  Group,
  GroupTitle,
  Row,
  Label,
  Help,
  Field,
  Source,
  State,
  Input,
  Select,
  Actions,
  Action,
  Error: ErrorText,
} = Frame
let Tab = el('button', 'Tab')

// The sidebar door. Named for what it opens, never a provider — the panel it
// raises carries the Codex ceremony as one section among the runtime settings.
export let ConfigTab = ({ text = false }: { text?: boolean }) => (
  <Tab
    class='ConfigTab'
    type='button'
    mod={configOpen.value && 'on'}
    aria-label='Configuration'
    data-tip='Configuration'
    onClick={openConfig}
  >
    <Icon name='settings' />
    {text && <span>Configuration</span>}
  </Tab>
)

type ConfigKey = {
  key: string
  target: unknown
  preventDefault: () => void
  stopImmediatePropagation: () => void
}

// The panel owns the keyboard while open (Escape closes), but never steals a
// key that activates a control or writes into a field — the same contract as
// the account dialog, plus <select> for backend choice.
export let configKey = (event: ConfigKey) => {
  if (!configOpen.value) return false
  event.stopImmediatePropagation()
  let target = event.target as {
    matches?: (selector: string) => boolean
  } | null
  let activates = (event.key == 'Enter' || event.key == ' ') &&
    target?.matches?.('button, a[href]') === true
  let writes = target?.matches?.('input, textarea, select') === true
  if (event.key == 'Escape') dismissConfig()
  if (event.key != 'Tab' && !activates && !writes) event.preventDefault()
  return true
}

let sourceText = (source: SettingRow['source']) =>
  source == 'graph'
    ? 'saved here'
    : source == 'environment'
    ? 'from environment'
    : 'default'

// One non-secret setting: label, help, an editable input primed with the
// effective value, a source badge, save and reset-to-default. The draft is the
// mounted component's own state; when a save or reset lands (the row's value or
// source changes underneath), it resyncs to the new effective value.
let SettingItem = (
  { row, control }: { row: SettingRow; control: ConfigControl },
) => {
  let [draft, setDraft] = useState(row.value ?? '')
  useEffect(() => setDraft(row.value ?? ''), [row.value, row.source, row.eid])
  let view = control.view.value
  let busy = view.busy == row.key
  let error = view.rowError[row.key]
  let overridden = row.source == 'graph'
  let dirty = draft.trim() != '' &&
    (draft != (row.value ?? '') || !overridden)
  let id = `config-${row.key}`
  return (
    <Row>
      <Label for={id}>{row.label}</Label>
      <Help>{row.help}</Help>
      <Field>
        <Input
          id={id}
          type={row.type == 'url' ? 'url' : 'text'}
          value={draft}
          disabled={busy}
          autocomplete='off'
          spellcheck={false}
          placeholder={row.default ?? ''}
          aria-label={row.label}
          onInput={(event: InputEvent) =>
            setDraft((event.currentTarget as HTMLInputElement).value)}
        />
        <Source mod={row.source} data-source={row.source}>
          {sourceText(row.source)}
        </Source>
      </Field>
      {error && <ErrorText>{error}</ErrorText>}
      <Actions>
        <Action
          type='button'
          disabled={busy || !dirty}
          onClick={() => control.saveSetting(row.key, draft)}
        >
          {busy ? 'saving…' : 'save'}
        </Action>
        <Action
          type='button'
          disabled={busy || !overridden}
          onClick={() => control.resetSetting(row.key)}
        >
          reset to default
        </Action>
      </Actions>
    </Row>
  )
}

let stateText = (status: CredStatus) =>
  status.state == 'configured'
    ? `configured${status.source ? ` · ${status.source}` : ''}`
    : status.state == 'unavailable'
    ? 'unavailable'
    : 'not configured'

// One secret credential: state and backend only, never a value. The owner picks
// a backend — a plaintext secret stored locally, or a 1Password op:// reference
// — and the input is masked for the secret, plain for the (non-secret) op
// reference. The draft is cleared the moment it is submitted, so no secret ever
// lingers in the DOM, and nothing is ever read back to prefill it.
let CredItem = (
  { status, control }: { status: CredStatus; control: ConfigControl },
) => {
  let s = spec(status.key)
  let [mode, setMode] = useState<'value' | 'op'>('value')
  let [draft, setDraft] = useState('')
  let view = control.view.value
  let busy = view.busy == status.key
  let error = view.rowError[status.key]
  let submit = () => {
    if (!draft.trim()) return
    if (mode == 'op') control.bindCred(status.key, draft)
    else control.saveCred(status.key, draft)
    setDraft('')
  }
  return (
    <Row>
      <Label>{s?.label ?? status.key}</Label>
      {s?.help && <Help>{s.help}</Help>}
      <Field>
        <State mod={status.state} data-state={status.state}>
          {stateText(status)}
        </State>
      </Field>
      {status.detail && <ErrorText>{status.detail}</ErrorText>}
      {error && <ErrorText>{error}</ErrorText>}
      <Field>
        <Select
          value={mode}
          disabled={busy}
          aria-label={`${s?.label ?? status.key} backend`}
          onChange={(event: Event) =>
            setMode(
              (event.currentTarget as HTMLSelectElement).value as
                | 'value'
                | 'op',
            )}
        >
          <option value='value'>secret value</option>
          <option value='op'>1Password (op://)</option>
        </Select>
        <Input
          type={mode == 'op' ? 'text' : 'password'}
          value={draft}
          disabled={busy}
          autocomplete='off'
          spellcheck={false}
          placeholder={mode == 'op' ? 'op://vault/item/field' : 'paste secret'}
          aria-label={`${s?.label ?? status.key} ${
            mode == 'op' ? 'reference' : 'value'
          }`}
          onInput={(event: InputEvent) =>
            setDraft((event.currentTarget as HTMLInputElement).value)}
        />
      </Field>
      <Actions>
        <Action
          type='button'
          disabled={busy || !draft.trim()}
          onClick={submit}
        >
          {busy ? 'saving…' : 'save'}
        </Action>
        <Action
          type='button'
          disabled={busy || status.state == 'missing'}
          onClick={() => control.resetCred(status.key)}
        >
          reset
        </Action>
        <Action
          type='button'
          disabled={busy}
          onClick={() => control.refreshCred(status.key)}
        >
          refresh
        </Action>
        <Action
          type='button'
          disabled={busy || status.state == 'missing'}
          onClick={() => control.testCred(status.key)}
        >
          test
        </Action>
      </Actions>
    </Row>
  )
}

export let Config = (
  { control = configControl, codex = codexAccount }: {
    control?: ConfigControl
    codex?: AccountControl
  },
) => {
  let box = useRef<HTMLElement>(null)
  let view = control.view.value

  useEffect(() => {
    if (!configOpen.value) return
    control.read()
  }, [configOpen.value])
  useEffect(() => {
    if (!configOpen.value) return
    let key = (event: KeyboardEvent) => configKey(event)
    addEventListener('keydown', key, true)
    box.current?.focus()
    return () => removeEventListener('keydown', key, true)
  }, [configOpen.value])

  if (!configOpen.value) return null

  // Groups come from the catalog so the panel's order is the contract's order,
  // and a setting and its credential (Ollama's URL and key) sit together.
  let groups: string[] = []
  for (let s of catalog) if (!groups.includes(s.group)) groups.push(s.group)
  let settingsIn = (g: string) =>
    (view.settings ?? []).filter((r) => r.group == g)
  let credsIn = (g: string) =>
    (view.creds ?? []).filter((c) => spec(c.key)?.group == g)

  return (
    <Frame
      onMouseDown={(event: MouseEvent) =>
        event.target == event.currentTarget && dismissConfig()}
      onPointerDown={(event: PointerEvent) => event.stopPropagation()}
    >
      <Box
        elRef={box}
        role='dialog'
        aria-modal='true'
        aria-labelledby='config-title'
        tabIndex={-1}
      >
        <Head>
          <Title id='config-title'>Configuration</Title>
          <Close
            type='button'
            aria-label='Close configuration'
            onClick={dismissConfig}
          >
            ×
          </Close>
        </Head>
        <Body>
          {view.error && <ErrorText>{view.error}</ErrorText>}
          {groups.map((g) => (
            <Group key={g}>
              <GroupTitle>{g}</GroupTitle>
              {settingsIn(g).map((r) => (
                <SettingItem key={r.key} row={r} control={control} />
              ))}
              {credsIn(g).map((c) => (
                <CredItem key={c.key} status={c} control={control} />
              ))}
            </Group>
          ))}
          <Group>
            <GroupTitle>Codex account</GroupTitle>
            <CodexSection control={codex} view={codex.view.value} />
          </Group>
        </Body>
      </Box>
    </Frame>
  )
}
