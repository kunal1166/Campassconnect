import { useState, type FormEvent } from 'react'
import { ExternalLink, Globe, MapPin, Search, Sparkles } from 'lucide-react'
import {
  queryMapsGrounding,
  querySearchGrounding,
  type MapsGroundingResponse,
  type SearchGroundingResponse,
  type ShuttleData,
} from '../services/api'

const MAPS_QUICK_PROMPTS = [
  'Nearest metro and bus stops around UEM Kolkata',
  'Pharmacies, clinics, and ATMs near UEM Kolkata New Town',
  'Cafes and student eateries near UEM Kolkata',
]

const SEARCH_QUICK_PROMPTS = [
  'UEM Kolkata latest campus news and academic updates',
  'New Town Kolkata weather and transit advisory today',
  'Upcoming student hackathons and tech fests in Kolkata',
]

export function MapsGroundingPanel({ activeShuttle }: { activeShuttle?: ShuttleData }) {
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<MapsGroundingResponse | null>(null)

  const runQuery = async (prompt: string) => {
    const trimmed = prompt.trim()
    if (!trimmed) return
    setQuery(trimmed)
    setLoading(true)
    setError('')

    let coords: { lat: number; lng: number } | undefined
    if (activeShuttle?.latitude != null && activeShuttle?.longitude != null) {
      coords = { lat: activeShuttle.latitude, lng: activeShuttle.longitude }
    } else if (typeof navigator !== 'undefined' && navigator.geolocation) {
      coords = await new Promise<{ lat: number; lng: number } | undefined>((resolve) => {
        navigator.geolocation.getCurrentPosition(
          (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
          () => resolve(undefined),
          { timeout: 3000, maximumAge: 60000 }
        )
      })
    }

    try {
      const data = await queryMapsGrounding(trimmed, coords)
      setResult(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not fetch Maps-grounded places.')
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    runQuery(query)
  }

  return (
    <section className="panel" style={{ marginTop: '14px' }}>
      <div className="panel-head">
        <div>
          <h3>Nearby Campus &amp; Transit Guide (Google Maps Grounded)</h3>
          <p>Ask for verified transit stops, amenities, and campus surroundings powered by Gemini + Google Maps.</p>
        </div>
        <span className="feature-tag">MAPS GROUNDING</span>
      </div>

      <form onSubmit={handleSubmit} className="toolbar" style={{ marginBottom: '12px' }}>
        <div className="search-box" style={{ maxWidth: 'none' }}>
          <MapPin size={16} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Ask about transit stops, clinics, ATMs, or places near UEM Kolkata..."
          />
        </div>
        <button className="primary-button" type="submit" disabled={loading}>
          <Sparkles size={15} /> {loading ? 'Searching Maps…' : 'Ask Maps AI'}
        </button>
      </form>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '14px' }}>
        {MAPS_QUICK_PROMPTS.map((preset) => (
          <button
            key={preset}
            type="button"
            className="outline-button"
            disabled={loading}
            onClick={() => runQuery(preset)}
          >
            {preset}
          </button>
        ))}
      </div>

      {error && <div className="empty-state" style={{ color: '#b42318', background: '#fff1f0' }}>{error}</div>}

      {result && (
        <div style={{ display: 'grid', gap: '12px' }}>
          <div
            style={{
              background: '#f8f8fc',
              border: '1px solid #eceef4',
              borderRadius: '10px',
              padding: '14px',
              fontSize: '12px',
              lineHeight: 1.6,
              whiteSpace: 'pre-wrap',
              color: '#2c2f4a',
            }}
          >
            {result.text}
          </div>

          {result.places.length > 0 && (
            <div style={{ display: 'grid', gap: '8px' }}>
              <div className="eyebrow">GOOGLE MAPS SOURCES</div>
              <div style={{ display: 'grid', gap: '8px' }}>
                {result.places.map((place, idx) => (
                  <div
                    key={`${place.uri}-${idx}`}
                    style={{
                      border: '1px solid #eceef4',
                      borderRadius: '10px',
                      padding: '10px 12px',
                      background: '#fff',
                    }}
                  >
                    <a
                      href={place.uri}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                        color: '#684ee0',
                        fontWeight: 700,
                        fontSize: '12px',
                        textDecoration: 'none',
                      }}
                    >
                      <MapPin size={14} />
                      <span>{place.title}</span>
                      <ExternalLink size={12} />
                    </a>
                    {place.reviewSnippets && place.reviewSnippets.length > 0 && (
                      <ul style={{ margin: '6px 0 0 18px', padding: 0, fontSize: '11px', color: '#62667c' }}>
                        {place.reviewSnippets.map((snippet, sIdx) => (
                          <li key={sIdx}>{snippet}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  )
}

export function SearchGroundingPanel() {
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<SearchGroundingResponse | null>(null)

  const runSearch = async (prompt: string) => {
    const trimmed = prompt.trim()
    if (!trimmed) return
    setQuery(trimmed)
    setLoading(true)
    setError('')
    try {
      const data = await querySearchGrounding(trimmed)
      setResult(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not fetch Search-grounded updates.')
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    runSearch(query)
  }

  return (
    <section className="panel" style={{ marginTop: '14px' }}>
      <div className="panel-head">
        <div>
          <h3>Live Campus &amp; Local Web Briefings (Google Search Grounded)</h3>
          <p>Look up real-time campus announcements, local transit advisories, and Kolkata student events with Gemini + Google Search.</p>
        </div>
        <span className="feature-tag">SEARCH GROUNDING</span>
      </div>

      <form onSubmit={handleSubmit} className="toolbar" style={{ marginBottom: '12px' }}>
        <div className="search-box" style={{ maxWidth: 'none' }}>
          <Search size={16} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search live campus news, local transit alerts, or Kolkata events..."
          />
        </div>
        <button className="primary-button" type="submit" disabled={loading}>
          <Globe size={15} /> {loading ? 'Searching Web…' : 'Search Live Info'}
        </button>
      </form>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '14px' }}>
        {SEARCH_QUICK_PROMPTS.map((preset) => (
          <button
            key={preset}
            type="button"
            className="outline-button"
            disabled={loading}
            onClick={() => runSearch(preset)}
          >
            {preset}
          </button>
        ))}
      </div>

      {error && <div className="empty-state" style={{ color: '#b42318', background: '#fff1f0' }}>{error}</div>}

      {result && (
        <div style={{ display: 'grid', gap: '12px' }}>
          <div
            style={{
              background: '#f8f8fc',
              border: '1px solid #eceef4',
              borderRadius: '10px',
              padding: '14px',
              fontSize: '12px',
              lineHeight: 1.6,
              whiteSpace: 'pre-wrap',
              color: '#2c2f4a',
            }}
          >
            {result.text}
          </div>

          {result.sources.length > 0 && (
            <div style={{ display: 'grid', gap: '6px' }}>
              <div className="eyebrow">WEB SOURCES</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                {result.sources.map((src, idx) => (
                  <a
                    key={`${src.uri}-${idx}`}
                    href={src.uri}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="soft-button"
                    style={{ textDecoration: 'none' }}
                  >
                    <Globe size={13} />
                    <span>{src.title}</span>
                    <ExternalLink size={12} />
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
