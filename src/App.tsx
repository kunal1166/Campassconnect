import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import {
  Activity, ArrowDownRight, ArrowRight, Bell, Bus, Check, ChevronDown, CircleHelp,
  Clock3, Compass, Filter, Grid2X2, MapPin, Menu, Plus, Search, Settings, ShieldCheck,
  Sparkles, TrendingUp, Upload, UserRound, WalletCards, X, PackageSearch, Route, ChartNoAxesCombined
} from 'lucide-react'

import { createItem, createShuttleRoute, getInsights, getItems, getMe, login, register, logout, getNotifications, getShuttles, socketUrl, requestItemClaim, markAllNotificationsRead, type AppUser, type ApiNotification, type InsightsData, type ShuttleData, type MatchResult, getItemMatches, updateShuttleLocation, stopShuttleLocation } from './services/api'
import { io, type Socket } from 'socket.io-client'
import { ShuttleMapLegend } from './components/ShuttleMapLegend'
import { ShuttleMap, type RouteEtaInfo } from './components/ShuttleMap'
import { MapsGroundingPanel, SearchGroundingPanel } from './components/GroundingPanels'
import {
  type BrowserNotificationPermission,
  getAlertedMatchKeys,
  getBrowserNotificationPermission,
  markMatchKeyAlerted,
  requestBrowserNotificationPermission,
  showBrowserNotification,
} from './utils/browserNotifications'

type Page = 'Overview' | 'Lost & Found' | 'Shuttle Tracker' | 'Campus Insights' | 'Notifications'
type Item = { id: string | number; name: string; category: string; place: string; date: string; createdAt?: string; status: string; match: number; image: string; owner?: string | null }

function formatRelativeTime(timestamp?: string, fallback = ''): string {
  if (!timestamp) return fallback
  const parsed = new Date(timestamp).getTime()
  if (Number.isNaN(parsed)) return fallback
  const diffSeconds = Math.max(0, Math.floor((Date.now() - parsed) / 1000))
  if (diffSeconds < 60) return 'Just now'
  const minutes = Math.floor(diffSeconds / 60)
  if (minutes < 60) return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'} ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days} ${days === 1 ? 'day' : 'days'} ago`
  const weeks = Math.floor(days / 7)
  if (weeks < 5) return `${weeks} ${weeks === 1 ? 'week' : 'weeks'} ago`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months} ${months === 1 ? 'month' : 'months'} ago`
  const years = Math.floor(days / 365)
  return `${years} ${years === 1 ? 'year' : 'years'} ago`
}

const nav = [
  { label: 'Overview' as Page, icon: Grid2X2 },
  { label: 'Lost & Found' as Page, icon: PackageSearch },
  { label: 'Shuttle Tracker' as Page, icon: Bus },
  { label: 'Campus Insights' as Page, icon: ChartNoAxesCombined },
  { label: 'Notifications' as Page, icon: Bell },
]

function App() {
  const [page, setPage] = useState<Page>('Overview')
  const [items, setItems] = useState<Item[]>([])
  const [user, setUser] = useState<AppUser | null>(null)
  const [authOpen, setAuthOpen] = useState(false)
  const [apiState, setApiState] = useState<'loading'|'connected'|'offline'>('loading')
  const [serverNotifications, setServerNotifications] = useState<ApiNotification[]>([])
  const [matchResults, setMatchResults] = useState<MatchResult[]>([])
  const [matchMode, setMatchMode] = useState('')
  const [matchesOpen, setMatchesOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('All')
  const [myReportsOnly, setMyReportsOnly] = useState(false)
  const [showModal, setShowModal] = useState(false)
  const [mobileNav, setMobileNav] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem('campusconnect_sidebar_collapsed') === 'true'
    } catch {
      return false
    }
  })
  const [toast, setToast] = useState('')
  const [reportType, setReportType] = useState<'Lost' | 'Found'>('Lost')
  const [gmpQuotaExceeded, setGmpQuotaExceeded] = useState(false)
  const [notificationPermission, setNotificationPermission] = useState<BrowserNotificationPermission>(() => getBrowserNotificationPermission())
  const alertedMatchKeysRef = useRef<Set<string>>(new Set())
  const recentRelatedItemsRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileNav(false)
    }
    const onResize = () => {
      if (window.innerWidth > 800) setMobileNav(false)
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('resize', onResize)
    }
  }, [])

  const handleToggleSidebar = () => {
    if (typeof window !== 'undefined' && window.innerWidth <= 800) {
      setMobileNav(current => !current)
      return
    }
    setSidebarCollapsed(current => {
      const next = !current
      try {
        localStorage.setItem('campusconnect_sidebar_collapsed', String(next))
      } catch {
        // Ignore storage quota or privacy-mode errors
      }
      return next
    })
  }

  useEffect(() => {
    const onQuotaExceeded = () => setGmpQuotaExceeded(true)
    window.addEventListener('gmp-quota-exceeded', onQuotaExceeded)
    return () => window.removeEventListener('gmp-quota-exceeded', onQuotaExceeded)
  }, [])

  const notify = (message: string) => {
    setToast(message)
    window.setTimeout(() => setToast(''), 2800)
  }

  const enableBrowserAlerts = async () => {
    const result = await requestBrowserNotificationPermission()
    setNotificationPermission(result)
    if (result === 'granted') notify('Browser alerts enabled for lost-item matches.')
    else if (result === 'denied') notify('Browser notifications are blocked in browser settings.')
    else if (result === 'unsupported') notify('Browser notifications are not supported in this browser.')
  }

  const notifyBrowserLostMatch = (
    dedupKey: string,
    title: string,
    body: string,
    targetPage: Page,
    relatedItemId?: string
  ) => {
    const userId = user?.id
    if (alertedMatchKeysRef.current.has(dedupKey)) return
    if (userId && getAlertedMatchKeys(userId).has(dedupKey)) return
    if (relatedItemId && recentRelatedItemsRef.current.has(relatedItemId)) return

    alertedMatchKeysRef.current.add(dedupKey)
    if (userId) markMatchKeyAlerted(userId, dedupKey)
    if (relatedItemId) {
      recentRelatedItemsRef.current.add(relatedItemId)
      window.setTimeout(() => recentRelatedItemsRef.current.delete(relatedItemId), 10_000)
    }

    showBrowserNotification({
      title,
      body,
      tag: `campusconnect-match-${dedupKey}`,
      onClick: () => setPage(targetPage),
    })
  }

  const refreshItems = () => {
    getItems().then(({items: rows}) => {
      setItems(rows.map(row => ({ id: row.id, name: row.name, category: row.category, place: row.place, date: row.date, createdAt: row.createdAt, status: row.status, match: row.match || 0, image: row.image || '', owner: row.owner ?? null })))
      setApiState('connected')
    }).catch(() => { setItems([]); setApiState('offline') })
  }

  useEffect(() => {
    refreshItems()
    if (localStorage.getItem('campusconnect_token')) {
      getMe().then(({user: current}) => setUser(current)).catch(() => logout())
    }
  }, [])

  useEffect(() => {
    refreshItems()
    if (!user) { setServerNotifications([]); return }
    getNotifications().then(({notifications: rows}) => {
      setServerNotifications(rows)
      const latestUnreadMatch = rows.find(row => !row.read && row.type === 'match' && row.title.startsWith('Possible'))
      if (latestUnreadMatch) {
        notifyBrowserLostMatch(
          latestUnreadMatch._id,
          latestUnreadMatch.title,
          latestUnreadMatch.message,
          'Notifications',
          latestUnreadMatch.relatedItem ?? undefined
        )
      }
    }).catch(() => setServerNotifications([]))

    const token = localStorage.getItem('campusconnect_token')
    if (!token) return
    const socket = io(socketUrl, {
      transports: ['polling', 'websocket'],
      auth: { token },
    })
    socket.on('connect', () => {
      socket.emit('user:subscribe', token)
    })
    socket.on('notification:new', (incoming: ApiNotification) => {
      setServerNotifications(current => current.some(n => n._id === incoming._id) ? current : [incoming, ...current])
      refreshItems()
      if (incoming.type === 'match' && incoming.matchForLostItem !== false) {
        notifyBrowserLostMatch(
          incoming._id,
          incoming.title,
          incoming.message,
          'Notifications',
          incoming.relatedItem ?? undefined
        )
        notify(incoming.message)
      }
    })
    return () => { socket.disconnect() }
  }, [user])

  useEffect(() => {
    if (page === 'Overview' || page === 'Lost & Found' || page === 'Campus Insights') {
      refreshItems()
    }
  }, [page])

  const filteredItems = useMemo(() => items.filter(item =>
    (filter === 'All' || item.status === filter) &&
    (!myReportsOnly || Boolean(user && item.owner && String(item.owner) === String(user.id))) &&
    `${item.name} ${item.place} ${item.category}`.toLowerCase().includes(query.toLowerCase())
  ), [items, filter, myReportsOnly, user, query])

  const submitReport = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!user) {
      setAuthOpen(true)
      notify('Please sign in before submitting a campus report.')
      return
    }
    const form = new FormData(event.currentTarget)
    form.set('status', reportType)
    if (reportType === 'Lost' && notificationPermission === 'default') {
      const nextPermission = await requestBrowserNotificationPermission()
      setNotificationPermission(nextPermission)
    }
    try {
      const { item, matches = [] } = await createItem(form)
      refreshItems()
      getNotifications().then(({notifications: rows}) => {
        setServerNotifications(rows)
        if (user?.id && matches.length > 0) {
          const matchedIds = new Set(matches.map(m => String(m.id)))
          for (const row of rows) {
            if (row.relatedItem && matchedIds.has(String(row.relatedItem))) {
              alertedMatchKeysRef.current.add(row._id)
              markMatchKeyAlerted(user.id, row._id)
            }
          }
        }
      }).catch(() => {})
      setShowModal(false)
      setPage('Lost & Found')
      if (reportType === 'Lost' && matches.length > 0) {
        const topMatch = matches[0]
        notifyBrowserLostMatch(
          `submit-${item.id}-${topMatch.id}`,
          `Match found for "${item.name}"`,
          `"${topMatch.name}" at ${topMatch.place} (${topMatch.match}% match).`,
          'Lost & Found',
          topMatch.id
        )
        notify(`Match found for "${item.name}": "${topMatch.name}" (${topMatch.match}%).`)
      } else {
        notify(`${reportType} item report saved`)
      }
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not submit report. Is the backend running?')
    }
  }

  const handleAuth = async (mode: 'login'|'register', values: {name:string; email:string; password:string; role:'student'|'driver'}) => {
    try {
      const current = mode === 'login' ? await login(values.email, values.password) : await register(values.name, values.email, values.password, values.role)
      setUser(current)
      setAuthOpen(false)
      notify(`Welcome, ${current.name}`)
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Authentication failed')
    }
  }

  return (
    <div className={`app-shell ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
      <div
        className={`sidebar-backdrop ${mobileNav ? 'sidebar-backdrop-open' : ''}`}
        onClick={() => setMobileNav(false)}
        aria-hidden="true"
      />
      <aside className={`sidebar ${mobileNav ? 'sidebar-open' : ''}`} aria-label="Primary navigation">
        <div className="sidebar-head">
          <div className="brand"><div className="brand-mark"><Compass size={21}/></div><span>Campus<span className="brand-accent">Connect</span></span></div>
          <button
            type="button"
            className="sidebar-close icon-button"
            onClick={() => setMobileNav(false)}
            aria-label="Close navigation menu"
          >
            <X size={18}/>
          </button>
        </div>
        <div className="campus-label">YOUR CAMPUS</div>
        <nav>
          {nav.map(({ label, icon: Icon }) => (
            <button
              key={label}
              type="button"
              className={`nav-item ${page === label ? 'active' : ''}`}
              aria-label={label}
              aria-current={page === label ? 'page' : undefined}
              title={sidebarCollapsed ? label : undefined}
              onClick={() => { setPage(label); setMobileNav(false) }}
            >
              <Icon size={18}/>
              <span className="nav-label">{label}</span>
              {label === 'Notifications' && <i className="nav-dot"/>}
              <span className="nav-tooltip" role="tooltip" aria-hidden="true">{label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="help-card"><div className="help-icon"><CircleHelp size={18}/></div><b>Need a hand?</b><p>Find answers about campus services.</p><button type="button" onClick={() => { notify('Help centre coming soon'); setMobileNav(false) }}>Visit help centre <ArrowRight size={14}/></button></div>
        </div>
      </aside>

      <main className="main-area">
        {gmpQuotaExceeded && (
          <div className="bg-amber-50 border-b border-amber-200 text-amber-900 px-4 py-2.5 text-xs md:text-sm text-center sticky top-0 z-50 shadow-sm">
            <span>
              Google Maps Platform quota reached. If you are the app owner, visit{' '}
              <a
                href="https://developers.google.com/maps/ai/ai-studio?utm_campaign=gmp_mcp_codeassist_v1_aistudio#quota_exceeded_errors"
                target="_blank"
                rel="noopener noreferrer"
                className="underline font-semibold text-amber-950 hover:text-amber-800"
              >
                maps developer site
              </a>{' '}
              for instructions to update your account.
            </span>
          </div>
        )}
        <header className="topbar">
          <div className="topbar-left">
            <button
              type="button"
              className="sidebar-toggle icon-button"
              onClick={handleToggleSidebar}
              aria-label={mobileNav ? 'Close navigation menu' : sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              aria-expanded={mobileNav || !sidebarCollapsed}
              title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              <Menu size={20}/>
            </button>
            <div className="crumb">UEM Kolkata <span>/</span> <b>{page}</b></div>
          </div>
          <div className="top-actions">
            <button className="icon-button notification-button" onClick={() => setPage('Notifications')} aria-label="Notifications"><Bell size={19}/><i/></button>
            {user ? <button className="top-avatar" title={`Signed in as ${user.name} · Sign out`} onClick={() => { logout(); setUser(null); setMyReportsOnly(false); notify('Signed out') }}>{user.name.slice(0,2).toUpperCase()}</button> : <button className="soft-button" onClick={() => setAuthOpen(true)}>Sign in</button>}
          </div>
        </header>

        <div className="content">
          <div className={`connection-banner ${apiState}`}><span/> {apiState === 'connected' ? 'Connected to CampusConnect API · MongoDB data' : apiState === 'offline' ? 'Backend offline · live data unavailable' : 'Connecting to backend…'}</div>
          {page === 'Overview' && <Overview items={items} setPage={setPage} onReport={() => { if (!user) { setAuthOpen(true); notify('Sign in to submit a report.'); return } setShowModal(true) }} notify={notify}/>}
          {page === 'Lost & Found' && <LostFound items={filteredItems} query={query} setQuery={setQuery} filter={filter} setFilter={setFilter} myReportsOnly={myReportsOnly} onToggleMyReports={() => { if (!user) { setAuthOpen(true); notify('Sign in to filter by your submitted reports.'); return } setMyReportsOnly(current => !current) }} notificationPermission={notificationPermission} onEnableBrowserAlerts={enableBrowserAlerts} onReport={(type) => { if (!user) { setAuthOpen(true); notify('Sign in to submit a report.'); return } setReportType(type); setShowModal(true) }} notify={notify} onClaim={async (id) => { if (!user) { setAuthOpen(true); return } try { const result = await requestItemClaim(id); notify(result.message) } catch (error) { notify(error instanceof Error ? error.message : 'Claim request failed') } }} onFindMatches={async (id) => { try { const targetItem = items.find(i => i.id === id); const isUsersLostItem = Boolean(user && targetItem?.status === 'Lost' && targetItem.owner === user.id); if (isUsersLostItem && notificationPermission === 'default') { const nextPerm = await requestBrowserNotificationPermission(); setNotificationPermission(nextPerm); } const result = await getItemMatches(id); setMatchResults(result.matches); setMatchMode(result.aiMode); setMatchesOpen(true); const topMatch = result.matches[0]; const topScore = topMatch ? (topMatch.score ?? topMatch.match) : 0; if (isUsersLostItem && topMatch && topScore >= 25) { notifyBrowserLostMatch(`find-${targetItem!.id}-${topMatch.id}`, `Match found for "${targetItem!.name}"`, `"${topMatch.name}" at ${topMatch.place} (${topScore}% match).`, 'Lost & Found', String(topMatch.id)); } } catch (error) { notify(error instanceof Error ? error.message : 'Could not find matches') } }}/>}
          {page === 'Shuttle Tracker' && <Shuttle notify={notify} user={user}/>}
          {page === 'Campus Insights' && <Insights apiState={apiState} refreshKey={items.length} onRetryConnection={refreshItems}/>}
          {page === 'Notifications' && <NotificationsView rows={serverNotifications} signedIn={!!user} notificationPermission={notificationPermission} onEnableBrowserAlerts={enableBrowserAlerts} onSignIn={() => setAuthOpen(true)} onMarkRead={async () => { try { await markAllNotificationsRead(); setServerNotifications(rows => rows.map(row => ({...row, read:true}))); notify('All notifications marked as read') } catch (error) { notify(error instanceof Error ? error.message : 'Could not update notifications') } }}/>} 
        </div>
      </main>

      {matchesOpen && <MatchesModal rows={matchResults} mode={matchMode} onClose={() => setMatchesOpen(false)}/>}
      {authOpen && <AuthModal onClose={() => setAuthOpen(false)} onSubmit={handleAuth}/>}
      {showModal && <ReportModal type={reportType} setType={setReportType} onClose={() => setShowModal(false)} onSubmit={submitReport}/>}
      {toast && <div className="toast"><Check size={17}/>{toast}</div>}
    </div>
  )
}

function PageHeading({eyebrow, title, subtitle, action}: {eyebrow?: string, title: string, subtitle: string, action?: ReactNode}) {
  return <div className="page-heading"><div>{eyebrow && <div className="eyebrow">{eyebrow}</div>}<h1>{title}</h1><p>{subtitle}</p></div>{action}</div>
}

function Overview({items, setPage, onReport, notify}: {items: Item[], setPage: (p: Page)=>void, onReport: ()=>void, notify: (s:string)=>void}) {
  const [shuttles, setShuttles] = useState<ShuttleData[]>([])
  useEffect(() => {
    getShuttles().then(({shuttles: rows}) => setShuttles(rows)).catch(() => setShuttles([]))
  }, [])
  const openReports = items.filter(item => item.status === 'Lost' || item.status === 'Found').length
  const recoveredItems = items.filter(item => item.status === 'Claimed' || item.status === 'Resolved').length
  const recentItems = [...items].slice(0, 3)
  const activeShuttles = shuttles.filter(shuttle => shuttle.active).length
  return <>
    <section className="welcome-row"><div><div className="eyebrow">{new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" }).toUpperCase()}</div><h1>Welcome to CampusConnect</h1><p>Your campus, a little more connected.</p></div><button className="soft-button" onClick={() => notify('Campus guide coming soon')}><MapPin size={16}/> UEM Kolkata <ChevronDown size={15}/></button></section>
    <section className="hero-banner">
      <div className="hero-copy"><div className="hero-pill"><Sparkles size={13}/> YOUR SMART CAMPUS COMPANION</div><h2>Make campus life<br/><em>effortlessly connected.</em></h2><p>Find what matters. Get where you need to go. All in one place.</p><div className="hero-actions"><button className="button-white" onClick={() => setPage('Lost & Found')}>Explore Lost & Found <ArrowRight size={16}/></button><button className="hero-link" onClick={() => setPage('Shuttle Tracker')}>Track a shuttle</button></div></div>
      <div className="hero-art"><div className="orbit orbit-one"/><div className="orbit orbit-two"/><div className="hero-pin"><Bus size={31}/></div><div className="floating-chip chip-top"><span className="live-pulse"/> {activeShuttles} active shuttle{activeShuttles === 1 ? "" : "s"}</div><div className="floating-chip chip-bottom"><PackageSearch size={15}/> {items.length} campus report{items.length === 1 ? "" : "s"}</div></div>
    </section>
    <div className="section-title"><div><h2>Your campus at a glance</h2><p>A quick snapshot of what's happening today.</p></div><span className="live-status"><i/> LIVE CAMPUS</span></div>
    <section className="stats-grid">
      <Stat icon={<PackageSearch/>} tone="purple" label="Open reports" value={String(openReports)} change="From campus reports"/>
      <Stat icon={<ShieldCheck/>} tone="green" label="Items recovered" value={String(recoveredItems)} change="Claimed or resolved"/>
      <Stat icon={<Bus/>} tone="blue" label="Shuttles active" value={String(activeShuttles)} change="Registered active routes"/>
      <Stat icon={<Clock3/>} tone="orange" label="Average shuttle ETA" value="—" change="ETA unavailable"/>
    </section>
    <section className="dashboard-grid">
      <div className="panel recent-panel"><div className="panel-head"><div><h3>Recent campus reports</h3><p>Latest reports saved in the database.</p></div><button className="text-button" onClick={() => setPage('Lost & Found')}>View all <ArrowRight size={15}/></button></div>
        {recentItems.length ? recentItems.map(item => <div className="match-row" key={item.id}><div className="match-placeholder"><PackageSearch size={22}/></div><div className="match-info"><b>{item.name}</b><span><MapPin size={13}/> {item.place} · <time dateTime={item.createdAt} title={item.date}>{formatRelativeTime(item.createdAt, item.date)}</time></span><small>{item.category} · {item.status}</small></div></div>) : <p className="empty-state">No campus reports have been submitted yet.</p>}
      </div>
      <div className="panel shuttle-panel"><div className="panel-head"><div><h3>Campus shuttles</h3><p>Registered routes from the backend.</p></div><button className="text-button" onClick={() => setPage('Shuttle Tracker')}>View routes <ArrowRight size={14}/></button></div>
        {shuttles.length ? shuttles.slice(0, 3).map(shuttle => <div className="route-card" key={shuttle._id}><div className="route-icon"><Bus size={20}/></div><div className="route-main"><b>Route {shuttle.code}</b><span>{shuttle.origin} <ArrowRight size={12}/> {shuttle.destination}</span></div><div className="route-eta">{shuttle.latitude != null && shuttle.longitude != null ? "GPS" : "—"}<small>status</small></div></div>) : <p className="empty-state">No shuttle routes are registered yet.</p>}
      </div>
    </section>
    <div className="quick-actions"><button onClick={onReport}><span className="quick-icon purple"><Plus/></span><span><b>Report an item</b><small>Lost something or found it?</small></span><ArrowRight size={17}/></button><button onClick={() => setPage('Shuttle Tracker')}><span className="quick-icon blue"><Bus/></span><span><b>Find my shuttle</b><small>Live routes and arrival times</small></span><ArrowRight size={17}/></button><button onClick={() => setPage('Campus Insights')}><span className="quick-icon orange"><Activity/></span><span><b>Campus insights</b><small>Explore campus activity</small></span><ArrowRight size={17}/></button></div>
  </>
}

function Stat({icon, tone, label, value, change}: {icon: ReactNode, tone: string, label: string, value: string | number, change: string}) {
  return <div className="stat-card"><div className={`stat-icon ${tone}`}>{icon}</div><span>{label}</span><strong>{value}</strong><small><TrendingUp size={13}/>{change}</small></div>
}

function LostFound({items, query, setQuery, filter, setFilter, myReportsOnly, onToggleMyReports, notificationPermission, onEnableBrowserAlerts, onReport, notify, onClaim, onFindMatches}: {items: Item[], query: string, setQuery: (s:string)=>void, filter:string, setFilter:(s:string)=>void, myReportsOnly: boolean, onToggleMyReports: ()=>void, notificationPermission: BrowserNotificationPermission, onEnableBrowserAlerts: ()=>void, onReport:(t:'Lost'|'Found')=>void, notify:(s:string)=>void, onClaim:(id:string|number)=>void, onFindMatches:(id:string|number)=>void}) {
  return <>
    <PageHeading eyebrow="COMMUNITY RECOVERY" title="Lost & Found" subtitle="A little help from AI can bring your belongings back." action={<button className="primary-button" onClick={() => onReport('Lost')}><Plus size={17}/> Create a report</button>}/>
    <div className="feature-strip"><div className="feature-spark"><Sparkles/></div><div><b>AI-assisted matching is on</b><p>We compare image, description and location signals to surface likely matches.</p></div>{notificationPermission === 'default' ? <button type="button" className="outline-button" onClick={onEnableBrowserAlerts}><Bell size={14}/> Enable match alerts</button> : notificationPermission === 'granted' ? <span className="feature-tag">ALERTS ON</span> : notificationPermission === 'denied' ? <span className="feature-tag">ALERTS BLOCKED</span> : <span className="feature-tag">BETA</span>}</div>
    <div className="toolbar"><div className="search-box"><Search size={17}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search items, places or categories..."/></div><div className="report-buttons"><div className="filter-group"><Filter size={16}/>{['All','Lost','Found'].map(f=><button key={f} className={filter===f?'selected':''} onClick={()=>setFilter(f)}>{f}</button>)}</div><div className="filter-group"><UserRound size={15}/><button type="button" aria-pressed={myReportsOnly} className={myReportsOnly?'selected':''} onClick={onToggleMyReports}>My Reports</button></div></div></div>
    <div className="section-title compact"><div><h2>Community reports</h2><p>{items.length} reports matching your view.</p></div><div className="report-buttons"><button className="outline-button" onClick={()=>onReport('Lost')}>I lost something</button><button className="primary-button" onClick={()=>onReport('Found')}><Plus size={16}/> I found something</button></div></div>
    <div className="items-grid">{items.length ? items.map(item=><article className="item-card" key={item.id}><div className="item-image">{item.image ? <img src={item.image} alt={item.name}/> : <div className="match-placeholder"><PackageSearch size={28}/></div>}<span className={`status-badge ${item.status.toLowerCase()}`}>{item.status}</span>{item.match>0&&<span className="similarity"><Sparkles size={12}/>{item.match}% match</span>}</div><div className="item-body"><div className="item-category">{item.category}</div><h3>{item.name}</h3><p><MapPin size={13}/>{item.place}</p><div className="item-foot"><time dateTime={item.createdAt} title={item.date}>{formatRelativeTime(item.createdAt, item.date)}</time><button onClick={()=>item.status==='Lost'?onFindMatches(item.id):onClaim(item.id)}>{item.status==='Lost'?'Find matches':'Request claim'} <ArrowRight size={14}/></button></div></div></article>) : <p className="empty-state">{myReportsOnly ? "You haven't submitted any matching reports yet." : 'No reports found. Create the first campus report.'}</p>}</div>
  </>
}

function Shuttle({notify, user}: {notify:(s:string)=>void; user:AppUser|null}) {
  const [routes, setRoutes] = useState<ShuttleData[]>([])
  const [selectedRoute, setSelectedRoute] = useState('')
  const [lastUpdate, setLastUpdate] = useState<string>('')
  const [gpsSharing, setGpsSharing] = useState(false)
  const [gpsError, setGpsError] = useState('')
  const [gpsStatus, setGpsStatus] = useState('Not sharing')
  const [socketStatus, setSocketStatus] = useState<'connecting' | 'connected' | 'reconnecting' | 'disconnected'>('connecting')
  const [staleRoutes, setStaleRoutes] = useState<Record<string, boolean>>({})
  const [routeEtas, setRouteEtas] = useState<Record<string, RouteEtaInfo | null>>({})
  const [routeModalOpen, setRouteModalOpen] = useState(false)

  const gpsWatchId = useRef<number|null>(null)
  const socketRef = useRef<Socket | null>(null)
  const selectedRouteRef = useRef(selectedRoute)
  const sharingRouteRef = useRef('')
  const userRef = useRef(user)
  selectedRouteRef.current = selectedRoute
  userRef.current = user

  const refreshRoutes = async (showToast = false) => {
    try {
      const { shuttles } = await getShuttles()
      setRoutes(shuttles)
      const now = Date.now()
      const staleMap: Record<string, boolean> = {}
      for (const s of shuttles) {
        if (s.lastGpsAt && now - new Date(s.lastGpsAt).getTime() > 60_000) {
          staleMap[s.code] = true
        }
      }
      setStaleRoutes(staleMap)
      if (shuttles.length > 0 && (!selectedRouteRef.current || !shuttles.some(s => s.code === selectedRouteRef.current))) {
        const activeFirst = shuttles.find(s => s.latitude != null && s.longitude != null) || shuttles[0]
        setSelectedRoute(activeFirst.code)
      }
      if (showToast) notify('Shuttle routes refreshed')
    } catch {
      setRoutes([])
      if (showToast) notify('Could not fetch shuttle routes')
    }
  }

  const stopGps = (notifyBackend = true) => {
    if (gpsWatchId.current !== null) {
      navigator.geolocation.clearWatch(gpsWatchId.current)
      gpsWatchId.current = null
    }
    const activeCode = sharingRouteRef.current
    sharingRouteRef.current = ''
    setGpsSharing(false)
    setGpsStatus('Not sharing')
    if (notifyBackend && activeCode && (userRef.current?.role === 'driver' || userRef.current?.role === 'admin')) {
      stopShuttleLocation(activeCode).catch(() => {})
    }
  }

  const startGps = () => {
    if (user?.role !== 'driver' && user?.role !== 'admin') {
      notify('Sign in with a Driver account to share shuttle GPS')
      return
    }
    if (!selectedRouteRef.current) {
      setGpsError('Select or register a shuttle route first')
      return
    }
    if (!navigator.geolocation) {
      setGpsError('Geolocation is not supported by this browser')
      return
    }
    if (gpsWatchId.current !== null) {
      navigator.geolocation.clearWatch(gpsWatchId.current)
    }

    const routeCode = selectedRouteRef.current
    sharingRouteRef.current = routeCode
    setGpsError('')
    setGpsSharing(true)
    setGpsStatus(`Waiting for GPS permission on ${routeCode}…`)

    const watchId = navigator.geolocation.watchPosition(async position => {
      const targetCode = sharingRouteRef.current
      if (!targetCode) return
      try {
        const speedKmph = position.coords.speed != null && Number.isFinite(position.coords.speed) && position.coords.speed >= 0
          ? Number((position.coords.speed * 3.6).toFixed(1))
          : undefined
        const heading = position.coords.heading != null && Number.isFinite(position.coords.heading) && position.coords.heading >= 0
          ? position.coords.heading
          : undefined
        const timestamp = new Date(position.timestamp || Date.now()).toISOString()

        const { shuttle } = await updateShuttleLocation(targetCode, {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          heading,
          speedKmph,
          timestamp,
        })
        setRoutes(current => current.map(route => route.code === shuttle.code ? shuttle : route))
        setStaleRoutes(current => ({ ...current, [shuttle.code]: false }))
        setLastUpdate(new Date(shuttle.lastGpsAt || Date.now()).toLocaleTimeString())
        setGpsStatus(`Sharing ${targetCode} · Last sent ${new Date().toLocaleTimeString()}`)
        setGpsError('')
      } catch (error) {
        setGpsError(error instanceof Error ? error.message : 'Could not send GPS update')
      }
    }, error => {
      if (error.code === error.PERMISSION_DENIED) {
        setGpsError('Location permission denied. Allow browser location access to share shuttle GPS.')
        stopGps(false)
      } else if (error.code === error.POSITION_UNAVAILABLE) {
        setGpsError('Device location is currently unavailable.')
      } else if (error.code === error.TIMEOUT) {
        setGpsError('Location request timed out. Retrying…')
      } else {
        setGpsError(error.message)
      }
    }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 })

    gpsWatchId.current = watchId
  }

  // Stop GPS sharing automatically if the driver signs out or loses driver role
  useEffect(() => {
    if (gpsSharing && user?.role !== 'driver' && user?.role !== 'admin') {
      stopGps(false)
    }
  }, [gpsSharing, user?.id, user?.role])

  // Stop GPS sharing if the driver closes or navigates away from the session
  useEffect(() => {
    const onLeaveSession = () => {
      if (gpsWatchId.current !== null) {
        navigator.geolocation.clearWatch(gpsWatchId.current)
        gpsWatchId.current = null
      }
      const activeCode = sharingRouteRef.current
      if (activeCode && (userRef.current?.role === 'driver' || userRef.current?.role === 'admin')) {
        stopShuttleLocation(activeCode, true).catch(() => {})
      }
    }
    window.addEventListener('pagehide', onLeaveSession)
    return () => {
      window.removeEventListener('pagehide', onLeaveSession)
      onLeaveSession()
    }
  }, [])

  // Initialize routes & Socket.IO real-time listeners
  useEffect(() => {
    refreshRoutes()
    const socket = io(socketUrl, {
      transports: ['polling', 'websocket'],
      reconnection: true,
    })
    socketRef.current = socket

    socket.on('connect', () => {
      setSocketStatus('connected')
      refreshRoutes()
      if (selectedRouteRef.current) {
        socket.emit('shuttle:subscribe', selectedRouteRef.current)
      }
    })
    socket.on('disconnect', () => setSocketStatus('disconnected'))
    socket.on('connect_error', () => setSocketStatus('disconnected'))
    socket.io.on('reconnect_attempt', () => setSocketStatus('reconnecting'))

    socket.on('shuttle:location', (shuttle: ShuttleData) => {
      setRoutes(current => current.map(route => route.code === shuttle.code ? shuttle : route))
      setStaleRoutes(current => ({ ...current, [shuttle.code]: false }))
      setLastUpdate(new Date(shuttle.lastGpsAt || Date.now()).toLocaleTimeString())
    })

    socket.on('shuttle:stopped', (shuttle: ShuttleData) => {
      setRoutes(current => current.map(route => route.code === shuttle.code ? shuttle : route))
      setStaleRoutes(current => ({ ...current, [shuttle.code]: false }))
      setRouteEtas(current => ({ ...current, [shuttle.code]: null }))
      setLastUpdate('')
    })

    socket.on('shuttle:created', (shuttle: ShuttleData) => {
      setRoutes(current => current.some(r => r.code === shuttle.code) ? current : [...current, shuttle])
      if (!selectedRouteRef.current) {
        setSelectedRoute(shuttle.code)
      }
    })

    socket.on('shuttle:summary', (summary: { code: string; hasGps: boolean; lastGpsAt?: string }) => {
      setRoutes(current => current.map(route => {
        if (route.code !== summary.code) return route
        if (!summary.hasGps) {
          return { ...route, latitude: undefined, longitude: undefined, speedKmph: undefined, lastGpsAt: undefined }
        }
        return { ...route, lastGpsAt: summary.lastGpsAt || route.lastGpsAt }
      }))
      if (!summary.hasGps) {
        setStaleRoutes(current => ({ ...current, [summary.code]: false }))
      }
    })

    socket.on('shuttle:stale', ({ code }: { code: string }) => {
      setStaleRoutes(current => ({ ...current, [code]: true }))
      notify(`${code} GPS signal is stale`)
    })

    return () => {
      socketRef.current = null
      socket.disconnect()
    }
  }, [])

  // Subscribe to the active route room whenever selectedRoute changes
  useEffect(() => {
    if (selectedRoute && socketRef.current?.connected) {
      socketRef.current.emit('shuttle:subscribe', selectedRoute)
    }
  }, [selectedRoute])

  const activeShuttle = routes.find(row => row.code === selectedRoute)
  const isDriverOrAdmin = user?.role === 'driver' || user?.role === 'admin'
  const activeIsStale = activeShuttle ? Boolean(staleRoutes[activeShuttle.code]) : false

  const handleCreateRoute = async (values: { code: string; routeName: string; origin: string; destination: string; stops: string[] }) => {
    try {
      const { shuttle } = await createShuttleRoute(values)
      setRoutes(current => current.some(r => r.code === shuttle.code) ? current : [...current, shuttle])
      setSelectedRoute(shuttle.code)
      setRouteModalOpen(false)
      notify(`Route ${shuttle.code} registered in database`)
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not create shuttle route')
    }
  }

  return <>
    <PageHeading
      eyebrow="CAMPUS MOBILITY"
      title="Shuttle tracker"
      subtitle="Know where your ride is, before you head out."
      action={
        <span className="live-status" style={socketStatus === 'connected' ? undefined : { color: '#ad7837' }}>
          <i style={socketStatus === 'connected' ? undefined : { background: '#e9a14d', boxShadow: '0 0 0 3px #e9a14d22' }}/>
          {socketStatus === 'connected' ? 'SOCKET.IO CONNECTED' : socketStatus === 'reconnecting' ? 'RECONNECTING…' : socketStatus === 'connecting' ? 'CONNECTING…' : 'SOCKET.IO DISCONNECTED'}
        </span>
      }
    />
    {isDriverOrAdmin ? (
      <div className="driver-console">
        <div>
          <b>Driver GPS beacon · {selectedRoute ? `Route ${selectedRoute}` : 'No route selected'}</b>
          <small>{gpsStatus}{gpsError ? ` · ${gpsError}` : ''}</small>
        </div>
        <div className="report-buttons">
          <button type="button" className="outline-button" onClick={() => setRouteModalOpen(true)}>
            <Plus size={15}/> Register route
          </button>
          <button
            type="button"
            className={gpsSharing ? 'outline-button' : 'primary-button'}
            disabled={!gpsSharing && !selectedRoute}
            onClick={() => gpsSharing ? stopGps(true) : startGps()}
          >
            {gpsSharing ? 'Stop sharing' : 'Start GPS sharing'}
          </button>
        </div>
      </div>
    ) : (
      <div className="driver-console">
        <div>
          <b>Want to share a shuttle location?</b>
          <small>Sign in or register with the Driver role on the top-right account menu, then allow location access.</small>
        </div>
      </div>
    )}
    <div className="shuttle-layout">
      <div className="panel route-list">
        <div className="panel-head">
          <div><h3>Campus routes</h3><p>Choose a route to see its journey.</p></div>
          <button className="icon-button" aria-label="Refresh routes" onClick={() => refreshRoutes(true)}><Activity size={17}/></button>
        </div>
        {routes.length ? routes.map((route) => {
          const hasGps = route.latitude != null && route.longitude != null
          const isStale = Boolean(staleRoutes[route.code])
          const eta = routeEtas[route.code]
          return (
            <button
              className={`route-option ${selectedRoute === route.code ? 'route-active' : ''}`}
              key={route._id || route.code}
              onClick={() => {
                setSelectedRoute(route.code)
                notify(`${route.code} selected`)
              }}
            >
              <div className="route-code">{route.code}</div>
              <div className="route-option-text">
                <b>{route.origin} <ArrowRight size={12}/> {route.destination}</b>
                <small>
                  {isStale ? 'GPS stale' : hasGps ? 'GPS live' : 'Awaiting GPS'}
                  {route.stops.length ? ` · Stops: ${route.stops.join(', ')}` : ''}
                </small>
              </div>
              <div className="route-time">
                {eta ? `${eta.durationMin}m` : hasGps && !isStale ? 'GPS' : '—'}
                <small>{eta ? 'ETA' : 'ETA unavailable'}</small>
              </div>
            </button>
          )
        }) : <p className="empty-state">No routes are configured in the database yet.</p>}
        <div className="driver-note"><ShieldCheck size={17}/><span><b>Location privacy</b><small>Driver location is shared only while on an active route.</small></span></div>
      </div>
      <div className="map-panel">
        <div className="map-top">
          <div>
            <b>{selectedRoute ? `Route ${selectedRoute} · Live location` : 'No active route selected'}</b>
            <span>
              <i style={activeIsStale || !(activeShuttle?.latitude != null) ? { background: '#d9a14d', boxShadow: '0 0 0 3px #d9a14d22' } : undefined}/>{' '}
              {activeIsStale
                ? `GPS signal stale${activeShuttle?.lastGpsAt ? ` (last seen ${new Date(activeShuttle.lastGpsAt).toLocaleTimeString()})` : ''}`
                : activeShuttle?.latitude != null
                  ? `Updated ${lastUpdate || (activeShuttle.lastGpsAt ? new Date(activeShuttle.lastGpsAt).toLocaleTimeString() : 'just now')}`
                  : 'Waiting for driver GPS'}
            </span>
          </div>
          {activeShuttle && activeShuttle.latitude != null && activeShuttle.longitude != null ? (
            <span className="map-layer">{activeShuttle.latitude.toFixed(5)}, {activeShuttle.longitude.toFixed(5)}</span>
          ) : null}
        </div>
        <ShuttleMap
          routes={routes}
          selectedRouteCode={selectedRoute}
          staleRoutes={staleRoutes}
          onRouteEtaChange={(code, info) => setRouteEtas(current => ({ ...current, [code]: info }))}
        />
        <ShuttleMapLegend />
      </div>
    </div>
    <div className="section-title compact">
      <div>
        <h2>Registered routes</h2>
        <p>Routes and GPS status fetched from the backend. ETA is shown only when calculated from live GPS and routing data.</p>
      </div>
      <span className="updated-label">{routes.length ? `Socket.IO ${socketStatus}` : 'No backend routes'}</span>
    </div>
    <div className="arrival-table">
      <div className="arrival-head"><span>ROUTE</span><span>ORIGIN, DESTINATION &amp; STOPS</span><span>ETA / GPS</span><span>LAST UPDATE</span></div>
      {routes.length ? routes.map(route => {
        const hasGps = route.latitude != null && route.longitude != null
        const isStale = Boolean(staleRoutes[route.code])
        const eta = routeEtas[route.code]
        return (
          <div className="arrival-row" key={route._id || route.code}>
            <b>{route.code}</b>
            <span>
              {route.origin} → {route.destination}
              {route.stops.length > 0 ? ` (${route.stops.join(' · ')})` : ''}
            </span>
            <strong>
              {eta
                ? `~${eta.durationMin} min`
                : isStale
                  ? 'GPS stale · ETA unavailable'
                  : hasGps
                    ? 'GPS live · ETA unavailable'
                    : 'ETA unavailable'}
            </strong>
            <span>{route.lastGpsAt ? new Date(route.lastGpsAt).toLocaleString() : 'No update'}</span>
          </div>
        )
      }) : <p className="empty-state">No shuttle route data is available.</p>}
    </div>
    <MapsGroundingPanel activeShuttle={activeShuttle} />
    {routeModalOpen && <AddRouteModal onClose={() => setRouteModalOpen(false)} onSubmit={handleCreateRoute} />}
  </>
}

function AddRouteModal({ onClose, onSubmit }: { onClose: () => void; onSubmit: (values: { code: string; routeName: string; origin: string; destination: string; stops: string[] }) => Promise<void> }) {
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal" onMouseDown={e => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <div className="eyebrow">SHUTTLE MANAGEMENT</div>
            <h2>Register shuttle route</h2>
            <p>Add a real shuttle route to the database so drivers can share live GPS.</p>
          </div>
          <button className="icon-button" onClick={onClose}><X size={20}/></button>
        </div>
        <form onSubmit={async e => {
          e.preventDefault()
          const d = new FormData(e.currentTarget)
          const stopsRaw = String(d.get('stops') || '')
          const stops = stopsRaw.split(',').map(s => s.trim()).filter(Boolean)
          await onSubmit({
            code: String(d.get('code') || '').trim().toUpperCase(),
            routeName: String(d.get('routeName') || '').trim(),
            origin: String(d.get('origin') || '').trim(),
            destination: String(d.get('destination') || '').trim(),
            stops,
          })
        }}>
          <label>Route code<input name="code" required maxLength={16} placeholder="e.g. R1" /></label>
          <label>Route name<input name="routeName" required placeholder="e.g. New Town Gate – UEM Kolkata" /></label>
          <label>Origin<input name="origin" required placeholder="e.g. Action Area III Gate, New Town" /></label>
          <label>Destination<input name="destination" required placeholder="e.g. University of Engineering & Management Kolkata" /></label>
          <label>Stops (comma-separated)<input name="stops" placeholder="e.g. Action Area III Gate, Biswa Bangla Gate, UEM Kolkata" /></label>
          <div className="modal-actions">
            <button type="button" className="outline-button" onClick={onClose}>Cancel</button>
            <button className="primary-button" type="submit">Save route <ArrowRight size={15}/></button>
          </div>
        </form>
      </div>
    </div>
  )
}


function Insights({
  apiState,
  refreshKey,
  onRetryConnection,
}: {
  apiState: 'loading' | 'connected' | 'offline';
  refreshKey: number;
  onRetryConnection: () => void;
}) {
  const [insights, setInsights] = useState<InsightsData | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [errorMessage, setErrorMessage] = useState('')

  const loadInsights = async () => {
    setStatus(current => (current === 'ready' && insights ? 'ready' : 'loading'))
    setErrorMessage('')
    try {
      const data = await getInsights()
      setInsights(data.insights)
      setStatus('ready')
    } catch (error) {
      setInsights(null)
      setStatus('error')
      setErrorMessage(
        error instanceof Error && error.message
          ? error.message
          : 'Unable to connect to the Express backend to load campus analytics.'
      )
    }
  }

  useEffect(() => {
    loadInsights()
  }, [refreshKey, apiState])

  const summary = insights?.summary
  const monthlyTrends = insights?.monthlyTrends ?? []
  const locationStats = insights?.locationStats ?? []
  const maxMonthlyTotal = monthlyTrends.reduce((max, row) => Math.max(max, row.total), 0)
  const maxLocationTotal = locationStats.reduce((max, row) => Math.max(max, row.total), 0)
  const lostVsFoundTotal = summary ? summary.lostReports + summary.foundReports : 0
  const lostShare = lostVsFoundTotal > 0 && summary ? Math.round((summary.lostReports / lostVsFoundTotal) * 100) : 0
  const foundShare = lostVsFoundTotal > 0 ? 100 - lostShare : 0

  return <>
    <PageHeading
      eyebrow="CAMPUS INTELLIGENCE"
      title="Campus insights"
      subtitle="Insights calculated from real campus reports."
      action={
        <button
          type="button"
          className="outline-button"
          onClick={() => {
            onRetryConnection()
            loadInsights()
          }}
        >
          <Activity size={15}/> Refresh analytics
        </button>
      }
    />

    {status === 'loading' && (
      <div className="panel">
        <div className="panel-head">
          <div>
            <h3>Loading campus analytics</h3>
            <p>Fetching aggregated report statistics from the backend.</p>
          </div>
        </div>
        <p className="empty-state">Connecting to the CampusConnect analytics endpoint…</p>
      </div>
    )}

    {status === 'error' && (
      <div className="panel" role="alert">
        <div className="panel-head">
          <div>
            <h3>Analytics unavailable · Backend connection error</h3>
            <p>Real metrics are hidden while the server or database is unreachable so zero values are never misrepresented.</p>
          </div>
          <button
            type="button"
            className="primary-button"
            onClick={() => {
              onRetryConnection()
              loadInsights()
            }}
          >
            Retry connection <ArrowRight size={15}/>
          </button>
        </div>
        <p className="empty-state">{errorMessage || 'Backend is offline. Start the Express server and MongoDB, then retry.'}</p>
      </div>
    )}

    {status === 'ready' && summary && (
      <>
        <div className="stats-grid insight-stats">
          <Stat
            icon={<PackageSearch/>}
            tone="purple"
            label="Total reports"
            value={summary.totalReports}
            change="Saved in the database"
          />
          <Stat
            icon={<ShieldCheck/>}
            tone="green"
            label="Items recovered"
            value={summary.itemsRecovered}
            change={summary.totalReports > 0 ? `${summary.recoveryRate}% recovery rate` : 'Claimed or resolved'}
          />
          <Stat
            icon={<ArrowDownRight/>}
            tone="orange"
            label="Active lost reports"
            value={summary.lostReports}
            change="Currently reported lost"
          />
          <Stat
            icon={<Sparkles/>}
            tone="blue"
            label="Active found reports"
            value={summary.foundReports}
            change="Reported found on campus"
          />
        </div>

        <div className="dashboard-grid insights-grid">
          <div className="panel">
            <div className="panel-head">
              <div>
                <h3>Monthly report trends</h3>
                <p>Report volume grouped by month from database timestamps.</p>
              </div>
              {monthlyTrends.length > 0 && (
                <span className="updated-label">{monthlyTrends.length} month{monthlyTrends.length === 1 ? '' : 's'} recorded</span>
              )}
            </div>
            {monthlyTrends.length > 0 ? (
              <>
                <div className="trend-number">
                  {summary.totalReports}{' '}
                  <span>
                    <TrendingUp size={13}/> {summary.recoveryRate}% recovered overall
                  </span>
                </div>
                <div className="bar-chart" aria-label="Monthly report volume chart">
                  {monthlyTrends.map(month => {
                    const heightPct = maxMonthlyTotal > 0 ? Math.max(12, Math.round((month.total / maxMonthlyTotal) * 100)) : 0
                    return (
                      <div
                        key={month.key}
                        style={{ height: `${heightPct}%` }}
                        title={`${month.label}: ${month.total} reports (${month.lost} lost, ${month.found} found, ${month.recovered} recovered)`}
                      />
                    )
                  })}
                </div>
                <div className="chart-months">
                  {monthlyTrends.map(month => (
                    <span key={month.key}>{month.label} ({month.total})</span>
                  ))}
                </div>
              </>
            ) : (
              <p className="empty-state">No monthly trend records are available in the database yet.</p>
            )}
          </div>

          <div className="panel">
            <div className="panel-head">
              <div>
                <h3>Lost vs Found comparison</h3>
                <p>Breakdown of open reports currently in the database.</p>
              </div>
              <span className="updated-label">{lostVsFoundTotal} open</span>
            </div>
            {summary.totalReports > 0 ? (
              <div className="grid gap-3">
                <div className="flex justify-between text-[11px] font-bold">
                  <span className="text-[#d56c75]">Lost: {summary.lostReports} ({lostShare}%)</span>
                  <span className="text-[#2d9b70]">Found: {summary.foundReports} ({foundShare}%)</span>
                </div>
                <div
                  className="route-progress m-0 flex h-2.5 bg-[#f0f1f5]"
                  role="img"
                  aria-label={`Lost ${summary.lostReports}, Found ${summary.foundReports}`}
                >
                  {lostShare > 0 && (
                    <span
                      className={foundShare === 0 ? 'h-full bg-[#d56c75] rounded-full' : 'h-full bg-[#d56c75] rounded-l-full'}
                      style={{ width: `${lostShare}%` }}
                    />
                  )}
                  {foundShare > 0 && (
                    <span
                      className={lostShare === 0 ? 'h-full bg-[#35aa78] rounded-full' : 'h-full bg-[#35aa78] rounded-r-full'}
                      style={{ width: `${foundShare}%` }}
                    />
                  )}
                </div>
                <div className="match-row">
                  <div className="stat-icon orange"><PackageSearch size={15}/></div>
                  <div className="match-info">
                    <b>Lost item reports</b>
                    <span>Active reports awaiting recovery</span>
                  </div>
                  <div className="match-score text-[#d56c75]">{summary.lostReports}</div>
                </div>
                <div className="match-row">
                  <div className="stat-icon green"><Compass size={15}/></div>
                  <div className="match-info">
                    <b>Found item reports</b>
                    <span>Turned in or logged by community</span>
                  </div>
                  <div className="match-score text-[#2d9b70]">{summary.foundReports}</div>
                </div>
                <div className="match-row">
                  <div className="stat-icon purple"><ShieldCheck size={15}/></div>
                  <div className="match-info">
                    <b>Claimed or resolved</b>
                    <span>Successfully returned items</span>
                  </div>
                  <div className="match-score">{summary.itemsRecovered}</div>
                </div>
              </div>
            ) : (
              <p className="empty-state">No Lost or Found reports have been recorded yet.</p>
            )}
          </div>
        </div>

        <div className="panel mt-4">
          <div className="panel-head">
            <div>
              <h3>Location-wise report statistics</h3>
              <p>Top campus locations aggregated from submitted item reports.</p>
            </div>
            {locationStats.length > 0 && (
              <span className="updated-label">{locationStats.length} location{locationStats.length === 1 ? '' : 's'}</span>
            )}
          </div>
          {locationStats.length > 0 ? (
            <div className="grid gap-2.5">
              {locationStats.map(loc => {
                const barWidth = maxLocationTotal > 0 ? Math.max(8, Math.round((loc.total / maxLocationTotal) * 100)) : 0
                return (
                  <div className="match-row items-center" key={loc.location}>
                    <div className="stat-icon purple"><MapPin size={15}/></div>
                    <div className="match-info gap-1.5">
                      <b>{loc.location}</b>
                      <div className="route-progress m-0">
                        <span style={{ width: `${barWidth}%` }} />
                      </div>
                      <span>{loc.lost} lost · {loc.found} found · {loc.recovered} recovered</span>
                    </div>
                    <div className="match-score">
                      {loc.total}
                      <small>reports</small>
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <p className="empty-state">No location statistics are available yet. Submit reports with campus locations to view this breakdown.</p>
          )}
        </div>
      </>
    )}

    <SearchGroundingPanel />
  </>
}

function NotificationsView({rows, signedIn, notificationPermission, onEnableBrowserAlerts, onSignIn, onMarkRead}: {rows:ApiNotification[]; signedIn:boolean; notificationPermission: BrowserNotificationPermission; onEnableBrowserAlerts: ()=>void; onSignIn:()=>void; onMarkRead:()=>void}) {
  const shown = signedIn ? rows.map(n=>({id:n._id,title:n.title,detail:n.message,time:new Date(n.createdAt).toLocaleString(),type:n.type,unread:!n.read})) : [];
  return <>
    <PageHeading eyebrow="STAY IN THE LOOP" title="Notifications" subtitle="The updates that matter to your campus day." action={<div className="report-buttons">{notificationPermission === 'default' && <button type="button" className="outline-button" onClick={onEnableBrowserAlerts}><Bell size={14}/> Enable browser alerts</button>}{signedIn ? <button className="outline-button" onClick={onMarkRead}>Mark all as read</button> : <button className="outline-button" onClick={onSignIn}>Sign in to sync</button>}</div>}/>
    {notificationPermission === 'denied' && <div className="feature-strip"><div className="feature-spark"><Bell/></div><div><b>Browser notifications are blocked</b><p>Allow notifications in your browser site settings to receive desktop alerts when a lost-item match is found.</p></div></div>}
    {!signedIn && <div className="feature-strip"><div className="feature-spark"><Bell/></div><div><b>Sign in to view notifications</b><p>Notifications are linked to your account. Sample notifications are not displayed.</p></div></div>}
    <div className="notification-list">{shown.length ? shown.map(n=><div className={`notification-card ${n.unread?'unread':''}`} key={n.id}><div className={`notification-icon ${n.type}`}>{n.type==='match'?<Sparkles/>:n.type==='bus'?<Bus/>:<Activity/>}</div><div className="notification-copy"><b>{n.title}</b><p>{n.detail}</p><small>{n.time}</small></div>{n.unread&&<span className="unread-dot"/>}</div>) : <p className="empty-state">{signedIn ? 'You have no notifications yet.' : 'Your account notifications will appear here after sign in.'}</p>}</div>
  </>
}

function ReportModal({type, setType, onClose, onSubmit}: {type:'Lost'|'Found', setType:(t:'Lost'|'Found')=>void, onClose:()=>void, onSubmit:(e:FormEvent<HTMLFormElement>)=>void}) {
  return <div className="modal-backdrop" onMouseDown={onClose}><div className="modal" onMouseDown={e=>e.stopPropagation()}><div className="modal-head"><div><div className="eyebrow">COMMUNITY REPORT</div><h2>Tell us about the item</h2><p>Share a few details so the community can help.</p></div><button className="icon-button" onClick={onClose}><X size={20}/></button></div><form onSubmit={onSubmit}><div className="segmented">{(['Lost','Found'] as const).map(t=><button type="button" className={type===t?'chosen':''} onClick={()=>setType(t)} key={t}>{t} item</button>)}</div><label>Item name<input name="name" required placeholder="e.g. Black laptop backpack"/></label><label>Category<select name="category"><option>Personal items</option><option>Electronics</option><option>Bags</option><option>Books & stationery</option><option>Accessories</option></select></label><label>Last seen / found location<input name="place" required placeholder="e.g. Central Library"/></label><label>Photo <div className="upload-box"><Upload size={19}/><span><b>Choose an item photo</b><small>JPEG, PNG or WEBP · up to 5 MB.</small></span><input type="file" name="image" accept="image/*" /></div></label><div className="modal-actions"><button type="button" className="outline-button" onClick={onClose}>Cancel</button><button className="primary-button" type="submit">Submit report <ArrowRight size={15}/></button></div></form></div></div>
}


function MatchesModal({rows, mode, onClose}: {rows:MatchResult[]; mode:string; onClose:()=>void}) {
  return <div className="modal-backdrop" onMouseDown={onClose}><div className="modal" onMouseDown={e=>e.stopPropagation()}><div className="modal-head"><div><div className="eyebrow">AI-ASSISTED SEARCH</div><h2>Potential matches</h2><p>Matching mode: {mode}. Scores rank candidates; they do not prove ownership.</p></div><button className="icon-button" onClick={onClose}><X size={20}/></button></div>{rows.length===0?<p className="empty-state">No possible matches found yet. Try again when more found-item reports are available.</p>:<div className="match-results">{rows.map(row=><div className="match-result" key={row.id}>{row.image ? <img src={row.image} alt={row.name}/> : <div className="match-placeholder"><PackageSearch size={24}/></div>}<div><b>{row.name}</b><small>{row.status} · {row.place}</small><small>Visual: {row.scoreBreakdown.visual===null?'Not available':`${row.scoreBreakdown.visual}%`} · Text: {row.scoreBreakdown.text}% · Location: {row.scoreBreakdown.location}%</small></div><strong>{row.score ?? row.match}%</strong></div>)}</div>}<div className="modal-actions"><button className="primary-button" onClick={onClose}>Close</button></div></div></div>
}

function AuthModal({onClose, onSubmit}: {onClose:()=>void; onSubmit:(mode:'login'|'register', values:{name:string;email:string;password:string;role:'student'|'driver'})=>void}) {
  const [mode,setMode] = useState<'login'|'register'>('login')
  const [role,setRole] = useState<'student'|'driver'>('student')
  return <div className="modal-backdrop" onMouseDown={onClose}><div className="modal auth-modal" onMouseDown={e=>e.stopPropagation()}>
    <div className="modal-head"><div><div className="eyebrow">CAMPUSCONNECT ACCOUNT</div><h2>{mode==='login'?'Welcome back':'Create your account'}</h2><p>Sign in to save reports and receive personal notifications.</p></div><button className="icon-button" onClick={onClose}><X size={20}/></button></div>
    <form onSubmit={e=>{e.preventDefault();const d=new FormData(e.currentTarget);onSubmit(mode,{name:String(d.get('name')||''),email:String(d.get('email')),password:String(d.get('password')),role})}}>
      {mode==='register' && <label>Full name<input name="name" required placeholder="Your name"/></label>}
      <label>Email address<input name="email" type="email" required placeholder="you@college.edu"/></label>
      <label>Password<input name="password" type="password" minLength={8} required placeholder="At least 8 characters"/></label>
      {mode==='register' && <label>Account type<select value={role} onChange={e=>setRole(e.target.value as 'student'|'driver')}><option value="student">Student</option><option value="driver">Driver</option></select></label>}
      <div className="modal-actions"><button type="button" className="text-button" onClick={()=>setMode(mode==='login'?'register':'login')}>{mode==='login'?'Create an account':'I already have an account'}</button><button className="primary-button" type="submit">{mode==='login'?'Sign in':'Register'} <ArrowRight size={15}/></button></div>
    </form>
  </div></div>
}

export default App
