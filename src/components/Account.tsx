// The web face of the server-owned Codex account: readiness, browser/device
// ceremonies, cancel and logout. Ceremony data lives only in the mounted
// client and every provider string reaches the DOM as text.
import { signal } from '@preact/signals'
import { useEffect, useRef } from 'preact/hooks'
import {
  type AccountControl,
  type Ceremony,
  codexAccount,
} from '../account_client.ts'
import { block, el } from './ui.tsx'
import { Icon } from './icons.tsx'

export let accountOpen = signal(false)
export let openAccount = () => accountOpen.value = true

let Frame = block('div', 'Account', {
  Box: 'section',
  Head: 'header',
  Title: 'h2',
  Close: 'button',
  Body: 'div',
  State: 'p',
  Detail: 'p',
  Error: 'p',
  Ceremony: 'div',
  Url: 'a',
  Code: 'code',
  Hint: 'p',
  Actions: 'footer',
  Action: 'button',
})
let {
  Box,
  Head,
  Title,
  Close,
  Body,
  State,
  Detail,
  Error: ErrorText,
  Ceremony: CeremonyBox,
  Url,
  Code,
  Hint,
  Actions,
  Action,
} = Frame
let Tab = el('button', 'Tab')

let label = (control: AccountControl) => {
  let status = control.view.value.status
  if (!status) return 'Codex account'
  if (status.ready) return `Codex · ${status.plan ?? status.auth}`
  if (status.state == 'pending') return 'Codex · login pending'
  return `Codex · ${status.state.replace('_', ' ')}`
}

export let AccountTab = (
  { control = codexAccount }: { control?: AccountControl },
) => (
  <Tab
    class='AccountTab'
    type='button'
    mod={accountOpen.value && 'on'}
    aria-label={label(control)}
    data-tip={label(control)}
    onClick={openAccount}
  >
    <Icon name='bot' />
  </Tab>
)

type Open = (url?: string | URL, target?: string) => Window | null

type AccountKey = {
  key: string
  target: unknown
  preventDefault: () => void
  stopImmediatePropagation: () => void
}

export let accountKey = (event: AccountKey) => {
  if (!accountOpen.value) return false
  event.stopImmediatePropagation()
  let target = event.target as {
    matches?: (selector: string) => boolean
  } | null
  let activates = (event.key == 'Enter' || event.key == ' ') &&
    target?.matches?.('button, a[href]') === true
  if (event.key == 'Escape') accountOpen.value = false
  if (event.key != 'Tab' && !activates) event.preventDefault()
  return true
}

// Opening a blank window inside the click keeps browser popup permission;
// detaching its opener before the request returns keeps the provider page
// from retaining a handle back into Tasks. A blocked popup leaves the same
// validated URL visible as an ordinary continuation link in the dialog.
export let browserLogin = async (
  control: AccountControl = codexAccount,
  open: Open | undefined = globalThis.open,
) => {
  let popup: Window | null = null
  try {
    popup = open?.('about:blank', '_blank') ?? null
    if (popup) popup.opener = null
  } catch { /* the ceremony remains visible in this window */ }
  let ceremony = await control.login('browser')
  if (ceremony?.method != 'browser') {
    popup?.close()
    return ceremony
  }
  try {
    popup?.location.replace(ceremony.authorizationUrl)
  } catch {
    popup?.close()
  }
  return ceremony
}

let Ceremony = ({ ceremony }: { ceremony?: Ceremony }) => {
  if (!ceremony) return null
  let href = ceremony.method == 'browser'
    ? ceremony.authorizationUrl
    : ceremony.verificationUrl
  return (
    <CeremonyBox>
      <Url href={href} target='_blank' rel='noopener noreferrer'>
        {ceremony.method == 'browser' ? 'continue sign in' : href}
      </Url>
      {ceremony.method == 'device' && <Code>{ceremony.userCode}</Code>}
      <Hint>
        {ceremony.method == 'device'
          ? 'Enter this one-time code in the page above.'
          : 'Complete sign in in the browser window.'}
      </Hint>
    </CeremonyBox>
  )
}

export let Account = (
  { control = codexAccount }: { control?: AccountControl },
) => {
  let box = useRef<HTMLElement>(null)
  let view = control.view.value
  let status = view.status
  let busy = view.busy

  useEffect(() => {
    if (!accountOpen.value) return
    control.read()
  }, [accountOpen.value])
  useEffect(() => {
    if (!accountOpen.value) return
    let key = (event: KeyboardEvent) => accountKey(event)
    addEventListener('keydown', key, true)
    box.current?.focus()
    return () => removeEventListener('keydown', key, true)
  }, [accountOpen.value])

  if (!accountOpen.value) return null
  let error = view.error ?? status?.error?.message
  let ready = status?.ready ? status : undefined
  let pending = status?.state == 'pending' ? status : undefined
  let state = busy == 'login'
    ? 'starting login…'
    : busy == 'cancel'
    ? 'cancelling…'
    : busy == 'logout'
    ? 'logging out…'
    : busy == 'read' && !status
    ? 'checking…'
    : ready
    ? 'ready'
    : pending
    ? `${pending.login ?? 'Codex'} login pending`
    : status?.state.replace('_', ' ') ?? 'not checked'
  return (
    <Frame
      onMouseDown={(event: MouseEvent) =>
        event.target == event.currentTarget && (accountOpen.value = false)}
      onPointerDown={(event: PointerEvent) => event.stopPropagation()}
    >
      <Box
        elRef={box}
        role='dialog'
        aria-modal='true'
        aria-labelledby='account-title'
        tabIndex={-1}
      >
        <Head>
          <Title id='account-title'>Codex account</Title>
          <Close
            type='button'
            aria-label='Close account'
            onClick={() => accountOpen.value = false}
          >
            ×
          </Close>
        </Head>
        <Body>
          <State mod={status?.state}>{state}</State>
          {ready && (
            <Detail>
              {ready.auth == 'chatgpt' ? 'ChatGPT' : 'API key'}
              {ready.plan && ` · ${ready.plan}`}
            </Detail>
          )}
          {error && <ErrorText>{error}</ErrorText>}
          <Ceremony ceremony={view.ceremony} />
          {pending && !view.ceremony && (
            <Hint>This login began in another Tasks client.</Hint>
          )}
        </Body>
        <Actions>
          {pending
            ? (
              <Action type='button' disabled={!!busy} onClick={control.cancel}>
                cancel login
              </Action>
            )
            : ready
            ? (
              <Action type='button' disabled={!!busy} onClick={control.logout}>
                log out
              </Action>
            )
            : (
              <>
                <Action
                  type='button'
                  disabled={!!busy}
                  onClick={() => browserLogin(control)}
                >
                  log in with ChatGPT
                </Action>
                <Action
                  type='button'
                  disabled={!!busy}
                  onClick={() => control.login('device')}
                >
                  use a device code
                </Action>
              </>
            )}
          <Action type='button' disabled={!!busy} onClick={control.read}>
            refresh
          </Action>
        </Actions>
      </Box>
    </Frame>
  )
}
