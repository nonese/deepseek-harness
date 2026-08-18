import { useState, type FormEvent } from 'react'
import { IconQuestionOutline14, IconUserOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import css from './LoginPage.module.css'

/** Login-screen actions owned by the pre-plugin shell. */
export interface LoginPageProps {
  oidcConfigured: boolean
  initialMessage?: string
  onLocalLogin(username: string, password: string): Promise<void>
  onOidcLogin(): void
}

/** Approved Harness login composition. */
export function LoginPage(props: LoginPageProps) {
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
          <span>Harness</span>
          <img src="/assets/harness-whale-mark.webp" alt="" aria-hidden="true" />
        </div>
        <section className={css.panel} aria-labelledby="login-title">
          <h1 id="login-title">登录你的工作空间</h1>
          <p className={css.lead}>进入你的个人项目、会话和设置。</p>

          <button
            className={css.ssoButton}
            type="button"
            disabled={!props.oidcConfigured}
            onClick={() => { props.onOidcLogin() }}
            aria-describedby="oidc-state"
          >
            <span className={css.ssoLabel}><IconUserOutline16 size={20} />使用企业 SSO 登录</span>
            <span id="oidc-state" className={css.buttonMeta}>
              {props.oidcConfigured ? 'OIDC' : '尚未配置'}
            </span>
          </button>

          <div className={css.divider}><span>或使用本地账号</span></div>

          <form onSubmit={submit} className={css.form}>
            <label>
              <span>用户名</span>
              <input
                name="username"
                autoComplete="username"
                value={username}
                onChange={(event) => { setUsername(event.target.value) }}
                placeholder="请输入用户名"
                required
                autoFocus
              />
            </label>
            <label>
              <span>密码</span>
              <input
                name="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => { setPassword(event.target.value) }}
                placeholder="请输入密码"
                required
              />
            </label>
            {message !== undefined && <div className={css.error} role="alert">{message}</div>}
            <button className={css.loginButton} type="submit" disabled={submitting}>
              {submitting ? '正在登录…' : '登录'}
            </button>
          </form>

          <div className={css.help}>
            <span><IconUserOutline16 size={15} />仅限授权的内部用户</span>
            <span><IconQuestionOutline14 size={15} />本地账号仅用于测试与应急</span>
          </div>
        </section>
      </div>
    </main>
  )
}
