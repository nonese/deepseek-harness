import { useState, type FormEvent } from 'react'
import { IconQuestionOutline14, IconUserOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import css from './LoginPage.module.css'
import { browserTranslate } from './locales.ts'

/** Login-screen actions owned by the pre-plugin shell. */
export interface LoginPageProps {
  oidcConfigured: boolean
  initialMessage?: string
  onLocalLogin(username: string, password: string): Promise<void>
  onOidcLogin(): void
}

/** Approved Harness login composition. */
export function LoginPage(props: LoginPageProps) {
  const t = browserTranslate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState(props.initialMessage)

  const submit = (event: FormEvent): void => {
    event.preventDefault()
    if (submitting) return
    setSubmitting(true)
    setMessage(undefined)
    void props.onLocalLogin(username, password).catch((error: unknown) => {
      setMessage(error instanceof Error ? error.message : String(error))
    }).finally(() => { setSubmitting(false) })
  }

  return (
    <main className={css.page}>
      <img
        className={css.scene}
        src="/assets/harness-login-hero.webp"
        alt=""
        aria-hidden="true"
        fetchPriority="high"
      />
      <div className={css.content}>
        <div className={css.brand}>
          <span>{t('brand.name')}</span>
        </div>
        <section className={css.panel} aria-labelledby="login-title">
          <h1 id="login-title">{t('login.title')}</h1>
          <p className={css.lead}>{t('login.lead')}</p>

          <button
            className={css.ssoButton}
            type="button"
            disabled={!props.oidcConfigured}
            onClick={() => { props.onOidcLogin() }}
            aria-describedby="oidc-state"
          >
            <span className={css.ssoLabel}><IconUserOutline16 size={20} />{t('login.sso')}</span>
            <span id="oidc-state" className={css.buttonMeta}>
              {props.oidcConfigured ? t('login.oidc') : t('login.notConfigured')}
            </span>
          </button>

          <div className={css.divider}><span>{t('login.localDivider')}</span></div>

          <form onSubmit={submit} className={css.form}>
            <label>
              <span>{t('users.username')}</span>
              <input
                name="username"
                autoComplete="username"
                value={username}
                onChange={(event) => { setUsername(event.target.value) }}
                placeholder={t('login.usernamePlaceholder')}
                required
                autoFocus
              />
            </label>
            <label>
              <span>{t('login.password')}</span>
              <input
                name="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => { setPassword(event.target.value) }}
                placeholder={t('login.passwordPlaceholder')}
                required
              />
            </label>
            {message !== undefined && <div className={css.error} role="alert">{message}</div>}
            <button className={css.loginButton} type="submit" disabled={submitting}>
              {submitting ? t('login.submitting') : t('login.submit')}
            </button>
          </form>

          <div className={css.help}>
            <span><IconUserOutline16 size={15} />{t('login.internalOnly')}</span>
            <span><IconQuestionOutline14 size={15} />{t('login.localHelp')}</span>
          </div>
        </section>
      </div>
    </main>
  )
}
