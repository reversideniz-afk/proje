// Ana sayfa: arkadaşlar (çevrimiçi ya da hepsi), bekleyen istekler ve
// arkadaş ekleme. Bir arkadaşa mesaj gönderince özel mesaj açılıyor.
import { useState } from 'react'
import { Check, MessageSquare, UserMinus, UserPlus, X } from 'lucide-react'
import { Avatar } from './Avatar.jsx'
import { presenceLine, statusLabel } from '../lib/presence.js'
import './FriendsPage.css'

function PersonRow({ person, children }) {
  const line = presenceLine(person) || statusLabel(person.online ? person.status : 'offline')
  return (
    <li className="friend-row">
      <Avatar name={person.username} src={person.avatarUrl} size="md" status={person.online ? person.status : 'offline'} />
      <span className="friend-text">
        <strong>{person.username}</strong>
        <span className="friend-line">{line}</span>
      </span>
      <span className="friend-actions">{children}</span>
    </li>
  )
}

function AddFriend({ onSendRequest }) {
  const [name, setName] = useState('')
  const [result, setResult] = useState(null) // { ok, text }
  const [busy, setBusy] = useState(false)
  return (
    <form
      className="friend-add"
      onSubmit={async (e) => {
        e.preventDefault()
        setBusy(true)
        const response = await onSendRequest(name.trim())
        setBusy(false)
        if (response?.success) {
          setResult({
            ok: true,
            text: response.accepted
              ? `${response.username} ile artık arkadaşsınız.`
              : `İstek gönderildi: ${response.username} kabul edince arkadaş olacaksınız.`,
          })
          setName('')
        } else {
          setResult({ ok: false, text: response?.message || 'İstek gönderilemedi.' })
        }
      }}
    >
      <label className="field-label" htmlFor="friend-add-name">
        Kullanıcı adı
      </label>
      <p className="field-hint">Arkadaşının Disco'daki adını yaz; büyük küçük harf fark etmez.</p>
      <div className="friend-add-row">
        <input
          id="friend-add-name"
          className="input"
          value={name}
          maxLength={32}
          onChange={(e) => {
            setName(e.target.value)
            setResult(null)
          }}
          autoFocus
        />
        <button type="submit" className="btn" disabled={busy || !name.trim()}>
          <UserPlus className="icon" />
          İstek gönder
        </button>
      </div>
      {result && (
        <p className={result.ok ? 'friend-add-ok' : 'form-error'} role={result.ok ? 'status' : 'alert'}>
          {result.text}
        </p>
      )}
    </form>
  )
}

export function FriendsPage({ friends, onSendRequest, onRespond, onRemove, onMessage }) {
  const [tab, setTab] = useState(() => (friends.incoming.length > 0 ? 'pending' : 'online'))
  const [confirmRemove, setConfirmRemove] = useState(null)
  const online = friends.friends.filter((f) => f.online)
  const pendingCount = friends.incoming.length + friends.outgoing.length
  const tabs = [
    { id: 'online', label: 'Çevrimiçi' },
    { id: 'all', label: 'Tümü' },
    { id: 'pending', label: pendingCount > 0 ? `Bekleyen (${pendingCount})` : 'Bekleyen' },
    { id: 'add', label: 'Arkadaş ekle' },
  ]
  const list = tab === 'online' ? online : friends.friends

  return (
    <section className="friends-page" aria-label="Arkadaşlar">
      <div className="friends-tabs" role="tablist" aria-label="Arkadaşlar">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={'friends-tab' + (t.id === 'add' ? ' friends-tab--add' : '')}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="friends-body">
        {tab === 'add' && <AddFriend onSendRequest={onSendRequest} />}

        {(tab === 'online' || tab === 'all') &&
          (list.length === 0 ? (
            <p className="friends-empty">
              {friends.friends.length === 0
                ? 'Henüz arkadaşın yok. "Arkadaş ekle"den adını yazarak istek gönderebilirsin.'
                : 'Şu an çevrimiçi arkadaşın yok.'}
            </p>
          ) : (
            <>
              <h3 className="friends-count">
                {tab === 'online' ? 'Çevrimiçi' : 'Bütün arkadaşlar'} — {list.length}
              </h3>
              <ul className="friend-list">
                {list.map((f) => (
                  <PersonRow key={f.username} person={f}>
                    <button
                      type="button"
                      className="icon-btn"
                      onClick={() => onMessage(f.username)}
                      aria-label={`${f.username}: mesaj gönder`}
                      title="Mesaj gönder"
                    >
                      <MessageSquare className="icon" />
                    </button>
                    {confirmRemove === f.username ? (
                      <button type="button" className="btn btn--danger btn--small" onClick={() => onRemove(f.username)}>
                        Çıkar
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="icon-btn"
                        onClick={() => setConfirmRemove(f.username)}
                        aria-label={`${f.username}: arkadaşlıktan çıkar`}
                        title="Arkadaşlıktan çıkar"
                      >
                        <UserMinus className="icon" />
                      </button>
                    )}
                  </PersonRow>
                ))}
              </ul>
            </>
          ))}

        {tab === 'pending' &&
          (pendingCount === 0 ? (
            <p className="friends-empty">Bekleyen istek yok.</p>
          ) : (
            <>
              {friends.incoming.length > 0 && (
                <>
                  <h3 className="friends-count">Gelen — {friends.incoming.length}</h3>
                  <ul className="friend-list" aria-label="Gelen istekler">
                    {friends.incoming.map((p) => (
                      <PersonRow key={p.username} person={p}>
                        <button
                          type="button"
                          className="icon-btn friend-accept"
                          onClick={() => onRespond(p.username, true)}
                          aria-label={`${p.username}: kabul et`}
                          title="Kabul et"
                        >
                          <Check className="icon" />
                        </button>
                        <button
                          type="button"
                          className="icon-btn"
                          onClick={() => onRespond(p.username, false)}
                          aria-label={`${p.username}: reddet`}
                          title="Reddet"
                        >
                          <X className="icon" />
                        </button>
                      </PersonRow>
                    ))}
                  </ul>
                </>
              )}
              {friends.outgoing.length > 0 && (
                <>
                  <h3 className="friends-count">Gönderilen — {friends.outgoing.length}</h3>
                  <ul className="friend-list" aria-label="Gönderilen istekler">
                    {friends.outgoing.map((p) => (
                      <PersonRow key={p.username} person={p}>
                        <button
                          type="button"
                          className="icon-btn"
                          onClick={() => onRemove(p.username)}
                          aria-label={`${p.username}: isteği geri al`}
                          title="İsteği geri al"
                        >
                          <X className="icon" />
                        </button>
                      </PersonRow>
                    ))}
                  </ul>
                </>
              )}
            </>
          ))}
      </div>
    </section>
  )
}
