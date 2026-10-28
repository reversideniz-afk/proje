// Tam ekran ayarlar: solda kategoriler, sağda seçilen kategorinin içeriği.
// Esc ya da sağ üstteki düğme kapatıyor.
import { useEffect, useRef, useState } from 'react'
import {
  Crown,
  Download,
  ImagePlus,
  KeyRound,
  LockOpen,
  LogOut,
  Monitor,
  Mic,
  Palette,
  RefreshCw,
  Server,
  ShieldAlert,
  Square,
  Trash2,
  User,
  UserMinus,
  Users,
  Volume2,
  X,
} from 'lucide-react'
import { Avatar } from './Avatar.jsx'
import { ZoomControl } from './ZoomControl.jsx'
import { IS_DESKTOP_APP, THEMES } from '../lib/config.js'
import { formatKeyCode } from '../lib/format.js'
import './SettingsScreen.css'

function Section({ title, description, children }) {
  return (
    <section className="settings-section">
      <h3 className="settings-section-title">{title}</h3>
      {description && <p className="field-hint">{description}</p>}
      {children}
    </section>
  )
}

function AccountPage({ account }) {
  const fileRef = useRef(null)
  return (
    <>
      <Section title="Profil">
        <div className="settings-profile">
          <Avatar name={account.displayName} src={account.avatarUrl} size="lg" />
          <div className="settings-profile-text">
            <strong className="settings-profile-name">{account.displayName}</strong>
            <span className="field-hint">Sohbette ve seste bu adla görünüyorsun.</span>
          </div>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0]
            e.target.value = ''
            if (file) account.onAvatarFile(file)
          }}
        />
        <div className="settings-row">
          <button type="button" className="btn btn--secondary" onClick={() => fileRef.current?.click()} disabled={account.isUploadingAvatar}>
            <ImagePlus className="icon" />
            {account.isUploadingAvatar ? 'Yükleniyor…' : 'Profil fotoğrafını değiştir'}
          </button>
        </div>
        {account.avatarError && (
          <p className="form-error" role="alert">
            {account.avatarError}
          </p>
        )}
      </Section>
    </>
  )
}

function AudioPage({ audio }) {
  return (
    <>
      <Section title="Mikrofon">
        <div className="field">
          <label className="field-label" htmlFor="settings-mic">
            Giriş cihazı
          </label>
          <select id="settings-mic" className="select" value={audio.selectedInput} onChange={(e) => audio.onSelectInput(e.target.value)}>
            <option value="">Varsayılan</option>
            {audio.inputs.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || 'Mikrofon'}
              </option>
            ))}
          </select>
        </div>
        <div className="settings-row">
          <button type="button" className="btn btn--secondary" onClick={audio.onTestMic}>
            {audio.isTestingMic ? <Square className="icon" /> : <Mic className="icon" />}
            {audio.isTestingMic ? 'Testi durdur' : 'Mikrofonu test et'}
          </button>
          {audio.isTestingMic && (
            <div className="mic-meter" role="meter" aria-label="Mikrofon seviyesi" aria-valuemin={0} aria-valuemax={100} aria-valuenow={audio.micLevel}>
              <div className="mic-meter-fill" style={{ width: `${audio.micLevel}%` }} />
            </div>
          )}
        </div>
        {audio.isTestingMic && <p className="field-hint">Konuş: çubuk hareket ediyorsa mikrofonun ses alıyor. Ses hoparlöre verilmiyor.</p>}
      </Section>
      <Section title="Hoparlör">
        <div className="field">
          <label className="field-label" htmlFor="settings-speaker">
            Çıkış cihazı
          </label>
          <select id="settings-speaker" className="select" value={audio.selectedOutput} onChange={(e) => audio.onSelectOutput(e.target.value)}>
            <option value="">Varsayılan</option>
            {audio.outputs.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || 'Hoparlör'}
              </option>
            ))}
          </select>
        </div>
        {audio.outputError && (
          <p className="form-error" role="alert">
            {audio.outputError}
          </p>
        )}
        <div className="settings-row">
          <button type="button" className="btn btn--secondary" onClick={audio.onTestTone}>
            <Volume2 className="icon" />
            Test sesi çal
          </button>
        </div>
        <p className="field-hint">Test sesini duyuyorsan sesli sohbetin sesi de bu cihazdan gelir.</p>
      </Section>
    </>
  )
}

function KeybindsPage({ ptt }) {
  return (
    <Section
      title="Bas-konuş"
      description={
        'Açarsan mikrofonun sürekli açık olmaz, sadece atadığın tuşu basılı tuttuğun sürece sesin gider. ' +
        (ptt.isGlobal
          ? 'Oyundayken ya da Disco arka plandayken de çalışır.'
          : 'Web sürümünde sadece bu sekme öndeyken çalışır; oyun içinde kullanmak için masaüstü uygulamasını kullan.')
      }
    >
      <div className="settings-row">
        {ptt.enabled ? (
          <>
            <span className="settings-key">
              <kbd>{formatKeyCode(ptt.key)}</kbd>
            </span>
            <button type="button" className="btn btn--secondary" onClick={ptt.onToggle}>
              Bas-konuşu kapat
            </button>
          </>
        ) : (
          <button type="button" className="btn" onClick={ptt.onToggle} disabled={ptt.isCapturing}>
            <KeyRound className="icon" />
            {ptt.isCapturing ? 'Bir tuşa bas…' : 'Bas-konuş tuşu ata'}
          </button>
        )}
      </div>
      {ptt.isCapturing && (
        <p className="field-hint" role="status">
          Klavyede bir tuşa ya da farenin yan tuşlarından birine bas. Vazgeçmek için Esc.
        </p>
      )}
    </Section>
  )
}

function AppearancePage({ appearance }) {
  return (
    <>
      <Section title="Vurgu rengi" description="Düğmeler, bağlantılar ve seçili öğeler bu renge boyanır.">
        <div className="theme-swatches" role="radiogroup" aria-label="Vurgu rengi">
          {THEMES.map((t) => (
            <button
              key={t.id}
              type="button"
              role="radio"
              aria-checked={appearance.theme === t.id}
              className={'theme-swatch' + (appearance.theme === t.id ? ' theme-swatch--active' : '')}
              style={{ '--swatch-color': t.color }}
              onClick={() => appearance.onThemeChange(t.id)}
            >
              <span className="theme-swatch-dot" />
              {t.label}
            </button>
          ))}
        </div>
      </Section>
      {IS_DESKTOP_APP && (
        <Section title="Yakınlaştırma" description="Ctrl + ve Ctrl − ile de değiştirebilirsin, Ctrl 0 sıfırlar.">
          <ZoomControl
            zoomLevel={appearance.zoomLevel}
            onZoomOut={appearance.onZoomOut}
            onZoomIn={appearance.onZoomIn}
            onReset={appearance.onZoomReset}
            isFullscreen={appearance.isFullscreen}
            onToggleFullscreen={appearance.onToggleFullscreen}
          />
        </Section>
      )}
    </>
  )
}

function Toggle({ label, hint, checked, disabled, onChange }) {
  return (
    <label className={'settings-toggle' + (disabled ? ' settings-toggle--disabled' : '')}>
      <span className="settings-toggle-text">
        <strong>{label}</strong>
        {hint && <span className="field-hint">{hint}</span>}
      </span>
      <input
        type="checkbox"
        role="switch"
        className="settings-switch"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
  )
}

function DesktopPage({ desktop }) {
  return (
    <Section title="Pencere">
      <Toggle
        label="Kapatınca arka planda çalışmaya devam et"
        hint="Pencereyi kapatınca Disco tepsiye küçülür, seste kalırsın. Tamamen çıkmak için tepsideki simgeye sağ tıkla."
        checked={desktop.closeToTray}
        onChange={desktop.onCloseToTrayChange}
      />
      <Toggle
        label="Bilgisayar açılınca Disco'yu başlat"
        hint={desktop.openAtLogin === null ? 'Sadece kurulmuş uygulamada değiştirilebilir.' : undefined}
        checked={!!desktop.openAtLogin}
        disabled={desktop.openAtLogin === null}
        onChange={desktop.onOpenAtLoginChange}
      />
    </Section>
  )
}

function UpdatePage({ update }) {
  return (
    <Section title="Sürüm">
      <p className="settings-version">
        Disco <span className="settings-mono">{update.appVersion || '…'}</span>
        {update.ready && update.version && (
          <>
            {' '}
            · <span className="settings-mono">{update.version}</span> hazır
          </>
        )}
      </p>
      <div className="settings-row">
        {update.ready ? (
          <button type="button" className="btn" onClick={update.onInstall}>
            <Download className="icon" />
            Yeniden başlat ve güncelle
          </button>
        ) : (
          <button type="button" className="btn btn--secondary" onClick={update.onCheck}>
            <RefreshCw className="icon" />
            Güncellemeleri kontrol et
          </button>
        )}
      </div>
      {update.message && (
        <p className="field-hint" role="status">
          {update.message}
        </p>
      )}
    </Section>
  )
}

function ServerPage({ server }) {
  return (
    <>
      <Section title="Davet kodu" description="Hesabı olan biri Sunucu oluştur ya da katıl > Katıl ile bu koda girerek sunucuna katılabilir.">
        <div className="settings-row">
          <button type="button" className="btn btn--secondary" onClick={server.onShowInvite}>
            Davet kodunu göster
          </button>
        </div>
      </Section>
      <Section title={`Üyeler — ${server.members.length}`} description="Sunucu sahibi çıkarılamaz.">
        <ul className="settings-list">
          {server.members.map((m) => (
            <li key={m.username} className="settings-list-row">
              <Avatar name={m.username} src={m.avatarUrl} size="sm" />
              <span className="settings-list-name">
                {m.username}
                {m.isOwner && <Crown className="icon settings-owner" aria-label="Sunucu sahibi" />}
              </span>
              {!m.isOwner && (
                <button type="button" className="btn btn--ghost btn--small" onClick={() => server.onRemoveMember(m.username)}>
                  <UserMinus className="icon" />
                  Çıkar
                </button>
              )}
            </li>
          ))}
        </ul>
      </Section>
      <Section title="Tehlikeli bölge" description="Sunucu silinince bütün kanalları ve mesajları da silinir. Geri alınamaz.">
        <div className="settings-row">
          <button type="button" className="btn btn--danger" onClick={server.onDelete}>
            <Trash2 className="icon" />
            Sunucuyu sil
          </button>
        </div>
      </Section>
    </>
  )
}

function AdminUsersPage({ admin }) {
  return (
    <Section title="Kullanıcılar ve roller" description="Rol ekleyerek kullanıcıya rolle açılan kanallara erişim verebilirsin.">
      {admin.isLoadingUsers && <p className="field-hint">Yükleniyor…</p>}
      {admin.usersError && <p className="form-error">{admin.usersError}</p>}
      <ul className="settings-list">
        {admin.users.map((u) => (
          <li key={u.username} className="settings-list-row settings-list-row--wrap">
            <span className="settings-list-name">{u.username}</span>
            {u.isLoginLocked && (
              <button
                type="button"
                className="btn btn--secondary btn--small"
                onClick={() => admin.onUnlock(u.username)}
                title="Çok fazla yanlış şifre yüzünden kilitli"
              >
                <LockOpen className="icon" />
                Kilidi aç
              </button>
            )}
            <span className="settings-roles">
              {u.roles.map((role) => (
                <span key={role} className="role-chip">
                  {role}
                  <button type="button" onClick={() => admin.onRemoveRole(u.username, role)} aria-label={`${role} rolünü kaldır`} title="Rolü kaldır">
                    <X className="icon" />
                  </button>
                </span>
              ))}
              <input
                className="input role-input"
                placeholder="+ rol"
                aria-label={`${u.username} için rol ekle`}
                value={admin.roleInputs[u.username] || ''}
                onChange={(e) => admin.onRoleInputChange(u.username, e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    admin.onAddRole(u.username)
                  }
                }}
              />
            </span>
          </li>
        ))}
      </ul>
    </Section>
  )
}

function AdminSecurityPage({ admin }) {
  return (
    <Section title="Banlı adresler" description="Kayıt ekranında çok fazla yanlış davet kodu deneyen, kalıcı banlanmış IP adresleri.">
      {admin.isLoadingBans && <p className="field-hint">Yükleniyor…</p>}
      {!admin.isLoadingBans && admin.bans.length === 0 && <p className="field-hint">Banlı adres yok.</p>}
      <ul className="settings-list">
        {admin.bans.map((b) => (
          <li key={b.ip} className="settings-list-row">
            <span className="settings-list-name settings-mono">{b.ip}</span>
            <span className="field-hint">
              {b.reason} · {b.attemptCount} deneme
            </span>
            <button type="button" className="btn btn--ghost btn--small" onClick={() => admin.onUnban(b.ip)}>
              Banı kaldır
            </button>
          </li>
        ))}
      </ul>
    </Section>
  )
}

export function SettingsScreen({
  initialPage = 'account',
  onClose,
  onLogout,
  account,
  audio,
  ptt,
  appearance,
  desktop,
  update,
  server,
  admin,
}) {
  const [page, setPage] = useState(initialPage)
  const closeRef = useRef(null)

  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === 'Escape' && !ptt.isCapturing) onClose()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onClose, ptt.isCapturing])

  useEffect(() => {
    const previouslyFocused = document.activeElement
    closeRef.current?.focus()
    return () => previouslyFocused?.focus?.()
  }, [])

  const groups = [
    {
      title: 'Kullanıcı ayarları',
      items: [{ id: 'account', label: 'Hesabım', icon: User }],
    },
    {
      title: 'Uygulama ayarları',
      items: [
        { id: 'audio', label: 'Ses ve görüntü', icon: Volume2 },
        { id: 'keybinds', label: 'Tuş atamaları', icon: KeyRound },
        { id: 'appearance', label: 'Görünüm', icon: Palette },
        ...(desktop ? [{ id: 'desktop', label: 'Masaüstü', icon: Monitor }] : []),
        ...(IS_DESKTOP_APP ? [{ id: 'update', label: 'Güncelleme', icon: Download }] : []),
      ],
    },
    ...(server ? [{ title: server.name, items: [{ id: 'server', label: 'Sunucu ayarları', icon: Server }] }] : []),
    ...(admin
      ? [
          {
            title: 'Yönetim',
            items: [
              { id: 'admin-users', label: 'Kullanıcılar', icon: Users },
              { id: 'admin-security', label: 'Güvenlik', icon: ShieldAlert },
            ],
          },
        ]
      : []),
  ]
  const allItems = groups.flatMap((g) => g.items)
  const current = allItems.find((item) => item.id === page) || allItems[0]

  return (
    <div className="settings-screen" role="dialog" aria-modal="true" aria-label="Ayarlar">
      <nav className="settings-nav" aria-label="Ayar kategorileri">
        <div className="settings-nav-inner">
          {groups.map((group) => (
            <div key={group.title} className="settings-nav-group">
              <h2 className="settings-nav-title">{group.title}</h2>
              {group.items.map((item) => {
                const Icon = item.icon
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={'settings-nav-item' + (current.id === item.id ? ' settings-nav-item--active' : '')}
                    aria-current={current.id === item.id ? 'page' : undefined}
                    onClick={() => setPage(item.id)}
                  >
                    <Icon className="icon" />
                    {item.label}
                  </button>
                )
              })}
            </div>
          ))}
          <div className="settings-nav-group">
            <button type="button" className="settings-nav-item settings-nav-item--danger" onClick={onLogout}>
              <LogOut className="icon" />
              Çıkış yap
            </button>
          </div>
        </div>
      </nav>
      <main className="settings-content">
        <div className="settings-content-inner">
          <h2 className="settings-page-title">{current.label}</h2>
          {current.id === 'account' && <AccountPage account={account} />}
          {current.id === 'audio' && <AudioPage audio={audio} />}
          {current.id === 'keybinds' && <KeybindsPage ptt={ptt} />}
          {current.id === 'appearance' && <AppearancePage appearance={appearance} />}
          {current.id === 'desktop' && desktop && <DesktopPage desktop={desktop} />}
          {current.id === 'update' && <UpdatePage update={update} />}
          {current.id === 'server' && server && <ServerPage server={server} />}
          {current.id === 'admin-users' && admin && <AdminUsersPage admin={admin} />}
          {current.id === 'admin-security' && admin && <AdminSecurityPage admin={admin} />}
        </div>
        <div className="settings-close">
          <button ref={closeRef} type="button" className="settings-close-button" onClick={onClose} aria-label="Ayarları kapat">
            <X className="icon" />
          </button>
          <span aria-hidden="true">ESC</span>
        </div>
      </main>
    </div>
  )
}
