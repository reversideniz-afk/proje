// Kanal kenar çubuğu: sunucu başlığı ve menüsü, kanal listesi (seste kim
// varsa kanalın altında), altta "Ses bağlı" paneli ve kullanıcı paneli.
import { useCallback, useRef, useState } from 'react'
import {
  CalendarDays,
  ChevronDown,
  FolderPlus,
  Hash,
  Headphones,
  HeadphoneOff,
  Link,
  Mic,
  MicOff,
  Monitor,
  MonitorOff,
  PhoneOff,
  Plus,
  Settings,
  Signal,
  Smile,
  Users,
  Download,
  UserPlus,
  Volume2,
  X,
} from 'lucide-react'
import { Avatar } from './Avatar.jsx'
import { useDismiss } from '../lib/useDismiss.js'
import { formatEventTime, formatKeyCode } from '../lib/format.js'
import { STATUSES, presenceLine, statusLabel } from '../lib/presence.js'
import { IS_DESKTOP_APP } from '../lib/config.js'

// Menüde sadece yetkisi olan işlemler (bkz. sunucuya özel roller).
function ServerHeader({ name, permissions, onInvite, onCreateChannel, onCreateCategory, onOpenServerSettings, onAddServer, onClose }) {
  const canOpenSettings = permissions.isOwner || permissions.createInvites || permissions.kickMembers
  const hasActions = permissions.createInvites || permissions.manageChannels || canOpenSettings
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef(null)
  const close = useCallback(() => setMenuOpen(false), [])
  useDismiss(menuRef, menuOpen, close)

  const run = (action) => () => {
    setMenuOpen(false)
    action()
  }

  return (
    <div className="sidebar-header" ref={menuRef}>
      <button
        type="button"
        className="sidebar-server-button"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen((open) => !open)}
      >
        <span className="sidebar-server-name">{name}</span>
        <ChevronDown className="icon" />
      </button>
      <button type="button" className="icon-btn mobile-only" onClick={onClose} aria-label="Kanalları kapat">
        <X className="icon" />
      </button>
      {menuOpen && (
        <div className="popover sidebar-server-menu" role="menu">
          {permissions.createInvites && (
            <button type="button" role="menuitem" className="menu-item" onClick={run(onInvite)}>
              <UserPlus className="icon" /> Arkadaşını davet et
            </button>
          )}
          {permissions.manageChannels && (
            <button type="button" role="menuitem" className="menu-item" onClick={run(onCreateChannel)}>
              <Plus className="icon" /> Kanal oluştur
            </button>
          )}
          {permissions.manageChannels && (
            <button type="button" role="menuitem" className="menu-item" onClick={run(onCreateCategory)}>
              <FolderPlus className="icon" /> Kategori oluştur
            </button>
          )}
          {canOpenSettings && (
            <button type="button" role="menuitem" className="menu-item" onClick={run(onOpenServerSettings)}>
              <Settings className="icon" /> Sunucu ayarları
            </button>
          )}
          {hasActions && <div className="menu-separator" />}
          <button type="button" role="menuitem" className="menu-item" onClick={run(onAddServer)}>
            <Link className="icon" /> Sunucu oluştur ya da katıl
          </button>
        </div>
      )}
    </div>
  )
}

// onEdit: sadece "Kanalları yönet" yetkisi olana. dragProps: sürükleyip
// bırakma (aynı yetki; bkz. ChannelList).
function ChannelRow({ channel, active, unread, mentions, isMyVoice, voicers, canJoinVoice, onOpen, onJoinVoice, onEdit, dragProps }) {
  return (
    <li {...dragProps} className={'channel-row' + (dragProps?.className ? ` ${dragProps.className}` : '')}>
      <button
        type="button"
        className={
          'channel-button' +
          (active ? ' channel-button--active' : '') +
          (unread ? ' channel-button--unread' : '')
        }
        aria-current={active ? 'page' : undefined}
        onClick={onOpen}
      >
        <Hash className="icon channel-hash" />
        <span className="channel-name">{channel.name}</span>
        {isMyVoice && <Volume2 className="icon channel-voice-indicator" aria-label="Bu kanalın sesindesin" />}
        {mentions > 0 ? (
          <span className="mention-badge" aria-label={`${mentions} kez bahsedildin`}>
            {mentions > 99 ? '99+' : mentions}
          </span>
        ) : (
          unread && <span className="channel-unread-dot" aria-label="Okunmamış mesaj var" />
        )}
      </button>
      {(canJoinVoice || onEdit) && (
        <div className="channel-actions">
          {onEdit && (
            <button
              type="button"
              className="icon-btn channel-action"
              onClick={onEdit}
              aria-label={`${channel.name} kanalını düzenle`}
              title="Kanalı düzenle"
            >
              <Settings className="icon" />
            </button>
          )}
          {canJoinVoice && (
            <button
              type="button"
              className="icon-btn channel-action channel-join-voice"
              onClick={onJoinVoice}
              aria-label={`${channel.name} sesine katıl`}
              title="Sese katıl"
            >
              <Headphones className="icon" />
            </button>
          )}
        </div>
      )}
      {voicers.length > 0 && (
        <ul className="channel-voicers" aria-label={`${channel.name} sesinde`}>
          {voicers.map((v) => (
            <li key={v.username} className={'channel-voicer' + (v.speaking ? ' is-speaking' : '')}>
              <Avatar name={v.username} src={v.avatarUrl} size="xs" speaking={v.speaking} />
              <span className="channel-voicer-name">{v.username}</span>
              {v.muted && <MicOff className="icon channel-voicer-muted" aria-label="Mikrofonu kapalı" />}
            </li>
          ))}
        </ul>
      )}
    </li>
  )
}

// isDm: ses özel mesajda ("@Ece"), değilse kanalda ("#genel").
function VoicePanel({ channelName, isDm, ping, reconnecting, isScreenSharing, onOpenChannel, onToggleScreenShare, onLeave }) {
  return (
    <section className="voice-panel" aria-label="Ses bağlantısı">
      <div className="voice-panel-info">
        <strong className={'voice-panel-status' + (reconnecting ? ' voice-panel-status--warn' : '')}>
          <Signal className="icon" />
          {reconnecting ? 'Yeniden bağlanıyor…' : 'Ses bağlı'}
        </strong>
        <button type="button" className="voice-panel-channel" onClick={onOpenChannel} title="Kanala git">
          {isDm ? '@' : '#'}
          {channelName}
          {typeof ping === 'number' && <span className="voice-panel-ping"> · {ping} ms</span>}
        </button>
      </div>
      <button
        type="button"
        className="icon-btn"
        aria-pressed={isScreenSharing}
        onClick={onToggleScreenShare}
        aria-label={isScreenSharing ? 'Ekran paylaşımını durdur' : 'Ekranı paylaş'}
        title={isScreenSharing ? 'Ekran paylaşımını durdur' : 'Ekranı paylaş'}
      >
        {isScreenSharing ? <MonitorOff className="icon" /> : <Monitor className="icon" />}
      </button>
      <button type="button" className="icon-btn icon-btn--danger voice-panel-leave" onClick={onLeave} aria-label="Sesten çık" title="Sesten çık">
        <PhoneOff className="icon" />
      </button>
    </section>
  )
}

// Ana sayfa (özel mesajlar): Arkadaşlar ve konuşmalar, en yeni üstte.
function DmNav({ home }) {
  const { dms, activeDmId, friendsActive, incomingCount, onOpenFriends, onOpenDm } = home
  return (
    <>
      <ul className="channel-list">
        <li className="channel-row">
          <button
            type="button"
            className={'channel-button' + (friendsActive ? ' channel-button--active' : '')}
            aria-current={friendsActive ? 'page' : undefined}
            onClick={onOpenFriends}
          >
            <Users className="icon channel-hash" />
            <span className="channel-name">Arkadaşlar</span>
            {incomingCount > 0 && (
              <span className="mention-badge" aria-label={`${incomingCount} arkadaşlık isteği`}>
                {incomingCount}
              </span>
            )}
          </button>
        </li>
      </ul>
      <div className="sidebar-category">
        <span>Konuşmalar</span>
      </div>
      {dms.length === 0 ? (
        <p className="sidebar-empty">Bir arkadaşına mesaj gönderince konuşma burada görünür.</p>
      ) : (
        <ul className="channel-list" aria-label="Konuşmalar">
          {dms.map((dm) => {
            const active = dm.id === activeDmId
            const line = presenceLine(dm)
            return (
              <li key={dm.id} className="channel-row">
                <button
                  type="button"
                  className={
                    'channel-button dm-button' +
                    (active ? ' channel-button--active' : '') +
                    (dm.unread > 0 && !active ? ' channel-button--unread' : '')
                  }
                  aria-current={active ? 'page' : undefined}
                  onClick={() => onOpenDm(dm)}
                >
                  <Avatar name={dm.username} src={dm.avatarUrl} size="sm" status={dm.online ? dm.status : null} />
                  <span className="dm-text">
                    <span className="channel-name">{dm.username}</span>
                    {line && <span className="dm-line">{line}</span>}
                  </span>
                  {dm.unread > 0 && !active && (
                    <span className="mention-badge" aria-label={`${dm.unread} okunmamış mesaj`}>
                      {dm.unread > 99 ? '99+' : dm.unread}
                    </span>
                  )}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </>
  )
}

// Sol alttaki kişiye tıklayınca: durum seçimi ve özel durum.
function StatusMenu({ status, customStatus, onSetStatus, onEditCustomStatus, onClearCustomStatus, onClose }) {
  const run = (action) => () => {
    onClose()
    action()
  }
  return (
    <div className="popover status-menu" role="menu" aria-label="Durum">
      {STATUSES.map((s) => (
        <button
          key={s.id}
          type="button"
          role="menuitemradio"
          aria-checked={status === s.id}
          className="menu-item status-menu-item"
          onClick={run(() => onSetStatus(s.id))}
        >
          <i className={`status-dot status-dot--${s.id === 'invisible' ? 'offline' : s.id}`} aria-hidden="true" />
          <span>
            <strong>{s.label}</strong>
            {s.hint && <span className="status-menu-hint">{s.hint}</span>}
          </span>
        </button>
      ))}
      <div className="menu-separator" />
      <button type="button" role="menuitem" className="menu-item" onClick={run(onEditCustomStatus)}>
        <Smile className="icon" /> {customStatus ? 'Özel durumu düzenle' : 'Özel durum ayarla'}
      </button>
      {customStatus && (
        <button type="button" role="menuitem" className="menu-item" onClick={run(onClearCustomStatus)}>
          <X className="icon" /> Özel durumu sil
        </button>
      )}
    </div>
  )
}

function UserPanel({
  displayName,
  avatarUrl,
  speaking,
  inVoice,
  isMicOn,
  isDeafened,
  pttEnabled,
  pttKey,
  status = 'online',
  customStatus,
  onSetStatus,
  onEditCustomStatus,
  onClearCustomStatus,
  onToggleMic,
  onToggleDeafen,
  onOpenSettings,
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const panelRef = useRef(null)
  const closeMenu = useCallback(() => setMenuOpen(false), [])
  useDismiss(panelRef, menuOpen, closeMenu)
  const micLabel = !inVoice
    ? 'Mikrofon (sese katılınca açılır)'
    : pttEnabled
      ? `Bas-konuş açık (${formatKeyCode(pttKey)})`
      : isMicOn
        ? 'Mikrofonu kapat'
        : 'Mikrofonu aç'
  const subtitle = customStatus || (pttEnabled ? `Bas-konuş: ${formatKeyCode(pttKey)}` : statusLabel(status))
  return (
    <section className="user-panel" aria-label="Kullanıcı paneli" ref={panelRef}>
      <button
        type="button"
        className="user-panel-me"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        aria-label={`Durumun: ${statusLabel(status)}. Değiştir`}
        title="Durumunu değiştir"
        onClick={onSetStatus ? () => setMenuOpen((open) => !open) : undefined}
      >
        <Avatar
          name={displayName}
          src={avatarUrl}
          size="sm"
          status={status === 'invisible' ? 'offline' : status}
          speaking={speaking}
        />
        <span className="user-panel-text">
          <strong className="whoami">{displayName}</strong>
          <span>{subtitle}</span>
        </span>
      </button>
      {menuOpen && (
        <StatusMenu
          status={status}
          customStatus={customStatus}
          onSetStatus={onSetStatus}
          onEditCustomStatus={onEditCustomStatus}
          onClearCustomStatus={onClearCustomStatus}
          onClose={closeMenu}
        />
      )}
      <button
        type="button"
        className={'icon-btn' + (inVoice && !isMicOn ? ' icon-btn--off' : '')}
        onClick={onToggleMic}
        disabled={!inVoice || pttEnabled}
        aria-label={micLabel}
        title={micLabel}
      >
        {inVoice && !isMicOn ? <MicOff className="icon" /> : <Mic className="icon" />}
      </button>
      <button
        type="button"
        className={'icon-btn' + (isDeafened ? ' icon-btn--off' : '')}
        onClick={onToggleDeafen}
        disabled={!inVoice}
        aria-label={isDeafened ? 'Sağırlaştırmayı kaldır' : 'Sağırlaştır'}
        title={isDeafened ? 'Sağırlaştırmayı kaldır' : 'Sağırlaştır'}
      >
        {isDeafened ? <HeadphoneOff className="icon" /> : <Headphones className="icon" />}
      </button>
      <button type="button" className="icon-btn" onClick={onOpenSettings} aria-label="Ayarlar" title="Ayarlar">
        <Settings className="icon" />
      </button>
    </section>
  )
}

// Daraltılan kategoriler kişinin kendi tarayıcısında (cihazına özel).
const COLLAPSED_KEY = 'collapsedCategories'

function readCollapsed() {
  try {
    return new Set(JSON.parse(window.localStorage.getItem(COLLAPSED_KEY) || '[]'))
  } catch {
    return new Set()
  }
}

// Kanal listesi: önce kategorisiz kanallar ("Kanallar" başlığı), sonra
// kategoriler. Başlığa tıklayınca kategori daralıyor (açık kanal yine
// görünüyor). "Kanalları yönet" yetkisi olan kanalları ve kategorileri
// sürükleyerek taşıyor: kanalı bir kanalın üstüne bırakınca onun önüne,
// başlığa bırakınca o kategorinin sonuna; kategoriyi bir kategorinin önüne
// ya da en sona. Telefonda sürükleme yok, kategori kanal düzenleme
// penceresinden seçiliyor.
function ChannelList({ channels, categories, manage, activeChannel, myVoiceChannel, onCreateChannel, onEditCategory, onMoveChannel, onMoveCategory, renderChannel }) {
  const [collapsed, setCollapsed] = useState(readCollapsed)
  const [drag, setDrag] = useState(null) // { kind: 'channel' | 'category', id }
  const [dropTarget, setDropTarget] = useState(null) // anahtar: 'channel:<id>', 'category:<id>', 'top', 'end'

  const toggle = (id) =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      try {
        window.localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...next]))
      } catch {
        // Saklanamıyorsa bu oturumluk kalıyor.
      }
      return next
    })

  // Bırakma hedefi: accepts(drag) doğruysa üstüne gelince işaretleniyor.
  const dropZone = (key, accepts, onDrop) =>
    manage && {
      onDragOver: (e) => {
        if (!drag || !accepts(drag)) return
        e.preventDefault()
        if (dropTarget !== key) setDropTarget(key)
      },
      onDragLeave: () => setDropTarget((current) => (current === key ? null : current)),
      onDrop: (e) => {
        e.preventDefault()
        if (drag && accepts(drag)) onDrop(drag)
        setDrag(null)
        setDropTarget(null)
      },
    }
  const dragSource = (kind, id) =>
    manage && {
      draggable: true,
      onDragStart: (e) => {
        e.stopPropagation()
        e.dataTransfer.effectAllowed = 'move'
        e.dataTransfer.setData('text/plain', id)
        setDrag({ kind, id })
      },
      onDragEnd: () => {
        setDrag(null)
        setDropTarget(null)
      },
    }
  const isChannel = (d) => d.kind === 'channel'

  const channelRow = (channel) =>
    renderChannel(channel, {
      ...dragSource('channel', channel.id),
      ...dropZone(`channel:${channel.id}`, (d) => isChannel(d) && d.id !== channel.id, (d) =>
        onMoveChannel(d.id, channel.categoryId || null, channel.id)
      ),
      className: dropTarget === `channel:${channel.id}` ? 'is-drop-target' : '',
    })

  const groups = [
    { category: null, channels: channels.filter((c) => !c.categoryId) },
    ...categories.map((category) => ({ category, channels: channels.filter((c) => c.categoryId === category.id) })),
  ]

  return (
    <>
      <div
        className={'sidebar-category' + (dropTarget === 'top' ? ' is-drop-target' : '')}
        {...dropZone('top', isChannel, (d) => onMoveChannel(d.id, null, null))}
      >
        <span>Kanallar</span>
        {manage && (
          <button type="button" className="icon-btn icon-btn--small" onClick={() => onCreateChannel(null)} aria-label="Kanal oluştur" title="Kanal oluştur">
            <Plus className="icon" />
          </button>
        )}
      </div>
      <ul className="channel-list">{groups[0].channels.map(channelRow)}</ul>
      {groups.slice(1).map(({ category, channels: inCategory }) => {
        // Görebildiği kanalı olmayan kategori sadece yönetene görünüyor.
        if (inCategory.length === 0 && !manage) return null
        const isCollapsed = collapsed.has(category.id)
        const shown = isCollapsed ? inCategory.filter((c) => c.id === activeChannel || c.id === myVoiceChannel) : inCategory
        const key = `category:${category.id}`
        return (
          <section key={category.id} className="channel-category" aria-label={`${category.name} kategorisi`}>
            <div
              className={'sidebar-category' + (dropTarget === key ? ' is-drop-target' : '')}
              {...dragSource('category', category.id)}
              {...dropZone(
                key,
                (d) => isChannel(d) || d.id !== category.id,
                (d) => (isChannel(d) ? onMoveChannel(d.id, category.id, null) : onMoveCategory(d.id, category.id))
              )}
            >
              <button type="button" className="channel-category-toggle" aria-expanded={!isCollapsed} onClick={() => toggle(category.id)}>
                <ChevronDown className={'icon channel-category-chevron' + (isCollapsed ? ' is-collapsed' : '')} />
                <span>{category.name}</span>
              </button>
              {manage && (
                <>
                  <button
                    type="button"
                    className="icon-btn icon-btn--small"
                    onClick={() => onCreateChannel(category.id)}
                    aria-label={`${category.name} kategorisine kanal oluştur`}
                    title="Kanal oluştur"
                  >
                    <Plus className="icon" />
                  </button>
                  <button
                    type="button"
                    className="icon-btn icon-btn--small"
                    onClick={() => onEditCategory(category)}
                    aria-label={`${category.name} kategorisini düzenle`}
                    title="Kategoriyi düzenle"
                  >
                    <Settings className="icon" />
                  </button>
                </>
              )}
            </div>
            <ul className="channel-list">{shown.map(channelRow)}</ul>
          </section>
        )
      })}
      {drag?.kind === 'category' && (
        <div
          className={'channel-category-end' + (dropTarget === 'end' ? ' is-drop-target' : '')}
          {...dropZone('end', (d) => d.kind === 'category', (d) => onMoveCategory(d.id, null))}
        >
          En sona taşı
        </div>
      )}
    </>
  )
}

export function ChannelSidebar({
  server,
  channels,
  activeChannel,
  unreadChannels,
  mentionCounts,
  voiceChannel,
  inVoice,
  // Bu sunucuda susturuldun: kanallardaki sese katılma düğmeleri gizli.
  voiceLocked = false,
  voicersByChannel,
  onOpenChannel,
  onJoinVoiceIn,
  onInvite,
  onCreateChannel,
  onEditChannel,
  // Kanal kategorileri (bkz. ChannelList): kategori penceresi ve taşıma.
  categories = [],
  onCreateCategory,
  onEditCategory,
  onMoveChannel,
  onMoveCategory,
  onOpenServerSettings,
  onAddServer,
  onClose,
  voicePanel,
  userPanel,
  update,
  home,
  events,
  onOpenEvent,
}) {
  return (
    <aside className="channel-sidebar" aria-label={home ? 'Özel mesajlar' : 'Kanallar'}>
      {home ? (
        <div className="sidebar-header">
          <span className="sidebar-server-name">Özel mesajlar</span>
          <button type="button" className="icon-btn mobile-only" onClick={onClose} aria-label="Kanalları kapat">
            <X className="icon" />
          </button>
        </div>
      ) : server ? (
        <ServerHeader
          name={server.name}
          permissions={server.permissions || {}}
          onInvite={onInvite}
          onCreateChannel={() => onCreateChannel(null)}
          onCreateCategory={onCreateCategory}
          onOpenServerSettings={onOpenServerSettings}
          onAddServer={onAddServer}
          onClose={onClose}
        />
      ) : (
        <div className="sidebar-header">
          <span className="sidebar-server-name">Disco</span>
          <button type="button" className="icon-btn mobile-only" onClick={onClose} aria-label="Kanalları kapat">
            <X className="icon" />
          </button>
        </div>
      )}

      <div className="sidebar-scroll">
        {home && <DmNav home={home} />}
        {!home && events?.length > 0 && (
          <>
            <div className="sidebar-category">
              <span>Yaklaşan</span>
            </div>
            <ul className="channel-list" aria-label="Yaklaşan etkinlikler">
              {events.slice(0, 3).map((event) => (
                <li key={event.id} className="channel-row">
                  <button type="button" className="channel-button dm-button" onClick={() => onOpenEvent(event)}>
                    <CalendarDays className="icon channel-hash" />
                    <span className="dm-text">
                      <span className="channel-name">{event.title}</span>
                      <span className="dm-line">
                        {formatEventTime(event.startsAt)} · {event.going.length} kişi
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
        {!home && server && (
          <ChannelList
            channels={channels}
            categories={categories}
            manage={!!server.permissions?.manageChannels}
            activeChannel={activeChannel}
            myVoiceChannel={inVoice ? voiceChannel : null}
            onCreateChannel={onCreateChannel}
            onEditCategory={onEditCategory}
            onMoveChannel={onMoveChannel}
            onMoveCategory={onMoveCategory}
            renderChannel={(channel, dragProps) => (
              <ChannelRow
                key={channel.id}
                channel={channel}
                active={activeChannel === channel.id}
                unread={unreadChannels.includes(channel.id)}
                mentions={mentionCounts[channel.id] || 0}
                isMyVoice={inVoice && voiceChannel === channel.id}
                voicers={voicersByChannel.get(channel.id) || []}
                canJoinVoice={!inVoice && !voiceLocked}
                onOpen={() => onOpenChannel(channel.id)}
                onJoinVoice={() => onJoinVoiceIn(channel.id)}
                onEdit={server?.permissions?.manageChannels ? () => onEditChannel(channel) : null}
                dragProps={dragProps}
              />
            )}
          />
        )}
      </div>

      {update && (
        <div className="update-banner" role="status">
          {update.ready ? (
            <button type="button" className="update-banner-button" onClick={update.onInstall}>
              <Download className="icon" />
              {IS_DESKTOP_APP ? 'Güncelleme hazır, yeniden başlat' : 'Güncelleme hazır, yenile'}
            </button>
          ) : (
            <span className="update-banner-progress">
              Güncelleme iniyor… %{update.progress}
              <span className="update-banner-bar" style={{ '--progress': `${update.progress}%` }} />
            </span>
          )}
        </div>
      )}
      {voicePanel && <VoicePanel {...voicePanel} />}
      <UserPanel {...userPanel} />
    </aside>
  )
}
