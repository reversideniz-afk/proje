// Giriş ve kayıt ekranı (ve "beni hatırla" ile oturum açılırken görünen
// bekleme ekranı). Alanlar etiketli; şifre yöneticileri tanısın diye
// autocomplete değerleri doğru.
import { Eye, EyeOff, LoaderCircle } from 'lucide-react'
import { DiscoBall } from './DiscoBall.jsx'
import './AuthScreen.css'

function AuthShell({ children, subtitle, invite }) {
  return (
    <div className="auth-screen">
      <main className="auth-card">
        <div className="auth-brand">
          <span className="auth-logo-glow" aria-hidden="true" />
          <DiscoBall color="#C9B8E8" size={72} facets={8} speed={10} className="auth-logo" />
          <h1 className="auth-title">Disco</h1>
          {subtitle && <p className="auth-subtitle">{subtitle}</p>}
        </div>
        {invite?.success && (
          <p className="auth-invite" role="status">
            Seni <strong>{invite.server.name}</strong> sunucusuna davet ettiler. Katılmak için giriş yap ya da hesap aç.
          </p>
        )}
        {invite && !invite.success && (
          <p className="auth-invite auth-invite--error" role="alert">
            Davet bağlantısı açılamadı: {invite.message}
          </p>
        )}
        {children}
      </main>
    </div>
  )
}

export function RestoringScreen() {
  return (
    <AuthShell subtitle="Oturum açılıyor…">
      <LoaderCircle className="icon auth-spinner" aria-hidden="true" />
    </AuthShell>
  )
}

export function PasswordField({ id, label, value, onChange, autoComplete, showPassword, onToggleShow, hint }) {
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <div className="password-field">
        <input
          id={id}
          className="input"
          type={showPassword ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete}
          required
        />
        <button
          type="button"
          className="icon-btn password-toggle"
          onClick={onToggleShow}
          aria-label={showPassword ? 'Şifreyi gizle' : 'Şifreyi göster'}
          title={showPassword ? 'Şifreyi gizle' : 'Şifreyi göster'}
        >
          {showPassword ? <EyeOff className="icon" /> : <Eye className="icon" />}
        </button>
      </div>
      {hint && <p className="field-hint">{hint}</p>}
    </div>
  )
}

export function AuthScreen({
  mode,
  onSwitchMode,
  username,
  onUsernameChange,
  password,
  onPasswordChange,
  showPassword,
  onToggleShowPassword,
  rememberMe,
  onRememberMeChange,
  inviteCode,
  onInviteCodeChange,
  onLogin,
  onRegister,
  isLoggingIn,
  isRegistering,
  loginError,
  registerError,
  registerSuccessMessage,
  invite,
}) {
  if (mode === 'register') {
    return (
      <AuthShell subtitle="Davet koduyla hesap aç" invite={invite}>
        <form className="auth-form" onSubmit={onRegister}>
          <div className="field">
            <label className="field-label" htmlFor="register-username">
              Kullanıcı adı
            </label>
            <input
              id="register-username"
              className="input"
              value={username}
              onChange={(e) => onUsernameChange(e.target.value)}
              autoComplete="username"
              autoFocus
              required
            />
          </div>
          <PasswordField
            id="register-password"
            label="Şifre"
            value={password}
            onChange={onPasswordChange}
            autoComplete="new-password"
            showPassword={showPassword}
            onToggleShow={onToggleShowPassword}
            hint="En az 6 karakter."
          />
          <div className="field">
            <label className="field-label" htmlFor="register-invite">
              Davet kodu
            </label>
            <input
              id="register-invite"
              className="input"
              value={inviteCode}
              onChange={(e) => onInviteCodeChange(e.target.value)}
              autoComplete="off"
              required
            />
            <p className="field-hint">Kodu seni davet eden arkadaşından alabilirsin.</p>
          </div>
          {registerError && (
            <p className="form-error" role="alert">
              {registerError}
            </p>
          )}
          <button type="submit" className="btn btn--block auth-submit" disabled={isRegistering}>
            {isRegistering ? 'Hesap açılıyor…' : 'Kayıt ol'}
          </button>
        </form>
        <p className="auth-switch">
          Zaten hesabın var mı?{' '}
          <button type="button" className="link-btn" onClick={() => onSwitchMode('login')}>
            Giriş yap
          </button>
        </p>
      </AuthShell>
    )
  }

  return (
    <AuthShell subtitle="Hesabınla giriş yap" invite={invite}>
      <form className="auth-form" onSubmit={onLogin}>
        <div className="field">
          <label className="field-label" htmlFor="login-username">
            Kullanıcı adı
          </label>
          <input
            id="login-username"
            className="input"
            value={username}
            onChange={(e) => onUsernameChange(e.target.value)}
            autoComplete="username"
            autoFocus
            required
          />
        </div>
        <PasswordField
          id="login-password"
          label="Şifre"
          value={password}
          onChange={onPasswordChange}
          autoComplete="current-password"
          showPassword={showPassword}
          onToggleShow={onToggleShowPassword}
        />
        <label className="checkbox">
          <input type="checkbox" checked={rememberMe} onChange={(e) => onRememberMeChange(e.target.checked)} />
          Beni hatırla
        </label>
        {loginError && (
          <p className="form-error" role="alert">
            {loginError}
          </p>
        )}
        {registerSuccessMessage && (
          <p className="form-success" role="status">
            {registerSuccessMessage}
          </p>
        )}
        <button type="submit" className="btn btn--block auth-submit" disabled={isLoggingIn}>
          {isLoggingIn ? 'Giriş yapılıyor…' : 'Giriş yap'}
        </button>
      </form>
      <p className="auth-switch">
        Davet kodun mu var?{' '}
        <button type="button" className="link-btn" onClick={() => onSwitchMode('register')}>
          Kayıt ol
        </button>
      </p>
    </AuthShell>
  )
}
