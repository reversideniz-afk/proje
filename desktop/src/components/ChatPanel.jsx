// Kanalın sohbeti: mesajlar, "yazıyor…" göstergesi ve yazma alanı. Sohbet
// alanına fotoğraf sürükleyip bırakınca kanala gönderiliyor.
import { useEffect, useState } from 'react'
import { ImagePlus, MessagesSquare } from 'lucide-react'
import { Composer } from './Composer.jsx'
import { MessageList } from './MessageList.jsx'
import './ChatPanel.css'

function typingText(names) {
  if (names.length === 1) return `${names[0]} yazıyor…`
  if (names.length === 2) return `${names[0]} ve ${names[1]} yazıyor…`
  return 'Birkaç kişi yazıyor…'
}

export function ChatPanel({
  variant = 'full',
  channelName,
  items,
  avatars,
  newSince,
  members,
  displayName,
  canModerate,
  hasMoreHistory,
  isLoadingOlder,
  onLoadOlder,
  typingUsers,
  onSend,
  onTyping,
  onPhotoFile,
  isSendingPhoto,
  onReact,
  onEdit,
  onDelete,
  onOpenPhoto,
  messagesRef,
}) {
  const [dragging, setDragging] = useState(false)
  const [replyingTo, setReplyingTo] = useState(null)
  // Başka kanala geçince yarım kalan yanıt düşüyor.
  useEffect(() => {
    setReplyingTo(null)
  }, [channelName])

  return (
    <section
      className={`chat-panel chat-panel--${variant}`}
      aria-label={`#${channelName} sohbeti`}
      onDragOver={(e) => {
        if (![...e.dataTransfer.types].includes('Files')) return
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setDragging(false)
      }}
      onDrop={(e) => {
        e.preventDefault()
        setDragging(false)
        const file = e.dataTransfer.files?.[0]
        if (file) onPhotoFile(file)
      }}
    >
      <div className="chat-messages" ref={messagesRef}>
        {hasMoreHistory && items.some((item) => item.id) && (
          <button type="button" className="btn btn--ghost btn--small chat-load-older" onClick={onLoadOlder} disabled={isLoadingOlder}>
            {isLoadingOlder ? 'Yükleniyor…' : 'Daha eski mesajları göster'}
          </button>
        )}
        {items.length === 0 && (
          <div className="chat-empty">
            <MessagesSquare className="icon chat-empty-icon" />
            <p className="chat-empty-title">#{channelName} sessiz.</p>
            <p className="chat-empty-text">İlk mesajı sen at. Fotoğraf yapıştırabilir, @ ile birini etiketleyebilirsin.</p>
          </div>
        )}
        <MessageList
          items={items}
          avatars={avatars}
          newSince={newSince}
          displayName={displayName}
          canModerate={canModerate}
          onReact={onReact}
          onEdit={onEdit}
          onDelete={onDelete}
          onOpenPhoto={onOpenPhoto}
          onReply={setReplyingTo}
          containerRef={messagesRef}
        />
      </div>

      <p className="chat-typing" aria-live="polite">
        {typingUsers.length > 0 && (
          <>
            <span className="chat-typing-dots" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            {typingText(typingUsers)}
          </>
        )}
      </p>

      <Composer
        channelName={channelName}
        members={members}
        displayName={displayName}
        onSend={(text) => {
          onSend(text, replyingTo?.id)
          setReplyingTo(null)
        }}
        replyingTo={replyingTo}
        onCancelReply={() => setReplyingTo(null)}
        onTyping={onTyping}
        onPhotoFile={onPhotoFile}
        isSendingPhoto={isSendingPhoto}
      />

      {dragging && (
        <div className="chat-drop-zone" aria-hidden="true">
          <ImagePlus className="icon" />
          <strong>Fotoğrafı bırak</strong>
          <span>#{channelName} kanalındakilere tek seferlik gönderilir</span>
        </div>
      )}
    </section>
  )
}
