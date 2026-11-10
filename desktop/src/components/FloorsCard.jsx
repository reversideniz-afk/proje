// Seste değilken solda: sunucunun dolu pistleri (ve şu an baktığın kanal,
// boş olsa da) kendi renklerindeki toplarıyla, yanlarında "Katıl". Altında
// yaklaşan etkinlikler.
import { CalendarDays } from 'lucide-react'
import { Avatar } from './Avatar.jsx'
import { DiscoBall } from './DiscoBall.jsx'
import { ballColorOf } from '../lib/discoBall.js'
import { formatEventTime } from '../lib/format.js'

export function FloorsCard({ channels, voicersByChannel, activeChannel, canJoin, onJoin, onOpenChannel, events = [], onOpenEvent }) {
  const floors = channels.filter((c) => c.id === activeChannel || (voicersByChannel.get(c.id) || []).length > 0)
  const total = channels.reduce((sum, c) => sum + (voicersByChannel.get(c.id) || []).length, 0)
  return (
    <section className="floors-card" aria-label="Pistler">
      <div className="card-head">
        <h2 className="card-title">Pistler</h2>
        <span className="card-meta">{total > 0 ? `şu an seste ${total} kişi` : 'şu an kimse seste değil'}</span>
      </div>
      {floors.length > 0 && (
        <ul className="floor-rows">
          {floors.map((channel) => {
            const voicers = voicersByChannel.get(channel.id) || []
            const line = voicers.length === 0 ? 'boş' : `${voicers.length} kişi`
            return (
              <li key={channel.id} className="floor-row">
                <DiscoBall color={ballColorOf(channel)} size={44} facets={6} speed={voicers.length ? 9 : 20} glow={voicers.length > 0} />
                <span className="floor-row-text">
                  <button type="button" className="floor-row-name" onClick={() => onOpenChannel(channel.id)}>
                    {channel.name}
                  </button>
                  <span className="floor-row-line">{line}</span>
                  {voicers.length > 0 && (
                    <ul className="floor-row-people" aria-label={`${channel.name} sesinde`}>
                      {voicers.slice(0, 6).map((v) => (
                        <li key={v.username} className="channel-voicer" title={v.username}>
                          <Avatar name={v.username} src={v.avatarUrl} size="xs" />
                          <span className="visually-hidden">{v.username}</span>
                        </li>
                      ))}
                      {voicers.length > 6 && <li className="floor-row-more">+{voicers.length - 6}</li>}
                    </ul>
                  )}
                </span>
                {canJoin && (
                  <button type="button" className="floor-join" onClick={() => onJoin(channel.id)} aria-label={`${channel.name} sesine katıl`}>
                    Katıl
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      )}
      {events.length > 0 && (
        <>
          <h3 className="card-subtitle">Yaklaşan</h3>
          <ul className="event-rows" aria-label="Yaklaşan etkinlikler">
            {events.slice(0, 3).map((event) => (
              <li key={event.id}>
                <button type="button" className="event-row" onClick={() => onOpenEvent(event)}>
                  <CalendarDays className="icon" aria-hidden="true" />
                  <span className="event-row-text">
                    <span className="event-row-title">{event.title}</span>
                    <span className="event-row-line">
                      {formatEventTime(event.startsAt)} · {event.going.length} kişi
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}
