// The web face of the server-owned Codex account: readiness, browser/device
// ceremonies, cancel and logout. Ceremony data lives only in the mounted
// client and every provider string reaches the DOM as text.
import { signal } from '@preact/signals'
import { useEffect, useRef, useState } from 'preact/hooks'
import {
  type AccountControl,
  type AccountView,
  type Ceremony,
  codexAccount,
} from '../account_client.ts'
import { block, el } from './ui.tsx'
import { Icon } from './icons.tsx'

export let accountOpen = signal(false)
export let openAccount = () => accountOpen.value = true
export let dismissAccount = (control: AccountControl = codexAccount) => {
  accountOpen.value = false
  control.dismiss()
}

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
  Callback: 'form',
  Input: 'input',
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
  Callback,
  Input,
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
  { control = codexAccount, text = false }: {
    control?: AccountControl
    text?: boolean
  },
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
    {text && <span>{label(control)}</span>}
  </Tab>
)

type Open = (url?: string | URL, target?: string) => Window | null

type AccountKey = {
  key: string
  target: unknown
  preventDefault: () => void
  stopImmediatePropagation: () => void
}

export let accountKey = (
  event: AccountKey,
  control: AccountControl = codexAccount,
) => {
  if (!accountOpen.value) return false
  event.stopImmediatePropagation()
  let target = event.target as {
    matches?: (selector: string) => boolean
  } | null
  let activates = (event.key == 'Enter' || event.key == ' ') &&
    target?.matches?.('button, a[href]') === true
  let writes = target?.matches?.('input, textarea') === true
  if (event.key == 'Escape') dismissAccount(control)
  if (event.key != 'Tab' && !activates && !writes) event.preventDefault()
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

export let finishLogin = (
  control: AccountControl,
  callback: string,
  clear: () => void,
) => {
  clear()
  if (callback) return control.complete(callback)
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
          ? 'Enter the code above. Device login must be enabled in ChatGPT settings or workspace permissions.'
          : 'Complete sign in in the browser window, then return here.'}
      </Hint>
    </CeremonyBox>
  )
}

// The Codex ceremony as a standalone section: state, the redacted detail, any
// error, the browser/device ceremony, the callback paste, and the login/logout/
// cancel/refresh actions. It owns only its callback draft and reads status on
// mount, so it drops unchanged into the modal below OR into the Configuration
// panel's Codex section — one ceremony, two containers. The `view` is passed in
// by the subscribing parent (the signals integration only re-renders a child
// when a prop changes), so a status update reaches this section through it.
export let CodexSection = (
  { control = codexAccount, view }: {
    control?: AccountControl
    view: AccountView
  },
) => {
  let [callback, setCallback] = useState('')
  let status = view.status
  let busy = view.busy

  useEffect(() => {
    if (status?.state != 'pending' || status.login != 'browser') setCallback('')
  }, [status?.state, status?.login])
  useEffect(() => {
    control.read()
  }, [])

  let error = view.error ?? status?.error
  let ready = status?.ready ? status : undefined
  let pending = status?.state == 'pending' ? status : undefined
  let state = busy == 'login'
    ? 'asking Codex to start login…'
    : busy == 'complete'
    ? 'delivering the callback and checking the Codex account…'
    : busy == 'cancel'
    ? 'asking Codex to cancel login…'
    : busy == 'logout'
    ? 'asking Codex to sign out…'
    : busy == 'read'
    ? 'checking Codex account status…'
    : ready
    ? 'ready'
    : pending
    ? `${pending.login ?? 'Codex'} login pending`
    : status?.state == 'error'
    ? 'last login failed'
    : status?.state.replace('_', ' ') ?? 'not checked'
  return (
    <>
      <Body>
        <State mod={status?.state}>{state}</State>
        {ready && (
          <Detail>
            {ready.auth == 'chatgpt' ? 'ChatGPT' : 'API key'}
            {ready.plan && ` · ${ready.plan}`}
          </Detail>
        )}
        {error && <ErrorText>{error.code} — {error.message}</ErrorText>}
        <Ceremony ceremony={view.ceremony} />
        {pending?.login == 'browser' && (
          <Callback
            onSubmit={(event: SubmitEvent) => {
              event.preventDefault()
              finishLogin(control, callback, () => setCallback(''))
            }}
          >
            <Hint>
              If the browser cannot reach this daemon, paste the full localhost
              callback URL from its address bar.
            </Hint>
            <Input
              type='url'
              name='callback'
              value={callback}
              required
              autocomplete='off'
              spellcheck={false}
              placeholder='http://localhost:…/auth/callback?code=…&state=…'
              aria-label='Codex callback URL'
              onInput={(event: InputEvent) =>
                setCallback((event.currentTarget as HTMLInputElement).value)}
            />
            <Action type='submit' disabled={!!busy || !callback}>
              finish login
            </Action>
          </Callback>
        )}
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
    </>
  )
}

export let Account = (
  { control = codexAccount }: { control?: AccountControl },
) => {
  let box = useRef<HTMLElement>(null)
  let view = control.view.value
  useEffect(() => {
    if (!accountOpen.value) return
    let key = (event: KeyboardEvent) => accountKey(event, control)
    addEventListener('keydown', key, true)
    box.current?.focus()
    return () => removeEventListener('keydown', key, true)
  }, [accountOpen.value])

  if (!accountOpen.value) return null
  return (
    <Frame
      onMouseDown={(event: MouseEvent) =>
        event.target == event.currentTarget && dismissAccount(control)}
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
            onClick={() => dismissAccount(control)}
          >
            ×
          </Close>
        </Head>
        <CodexSection control={control} view={view} />
      </Box>
    </Frame>
  )
}
