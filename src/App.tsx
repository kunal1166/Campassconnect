import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import {
  Activity, ArrowDownRight, ArrowRight, Bell, Bus, Check, ChevronDown, CircleHelp,
  Clock3, Compass, Filter, Grid2X2, MapPin, Menu, Plus, Search, Settings, ShieldCheck,
  Sparkles, TrendingUp, Upload, UserRound, WalletCards, X, PackageSearch, Route, ChartNoAxesCombined
} from 'lucide-react'

import { createItem, getItems, getMe, login, register, logout, getNotifications, getShuttles, socketUrl, requestItemClaim, markAllNotificationsRead, type AppUser, type ApiNotification, type ShuttleData, type MatchResult, getItemMatches, updateShuttleLocation } from './services/api'
import { io } from 'socket.io-client'

type Page = 'Overview' | 'Lost & Found' | 'Shuttle Tracker' | 'Campus Insights' | 'Notifications'
type Item = { id: string | number; name: string; category: string; place: string; date: string; status: string; match: number; image: string }

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
  const [showModal, setShowModal] = useState(false)
  const [mobileNav, setMobileNav] = useState(false)
  const [toast, setToast] = useState('')
  const [reportType, setReportType] = useState<'Lost' | 'Found'>('Lost')

  useEffect(() => {
    getItems().then(({items: rows}) => {
      setItems(rows.map(row => ({ id: row.id, name: row.name, category: row.category, place: row.place, date: row.date, status: row.status, match: row.match || 0, image: row.image || '' })))
      setApiState('connected')
    }).catch(() => { setItems([]); setApiState('offline') })
    if (localStorage.getItem('campusconnect_token')) {
      getMe().then(({user: current}) => setUser(current)).catch(() => logout())
    }
  }, [])

  useEffect(() => {
    if (!user) { setServerNotifications([]); return }
    getNotifications().then(({notifications: rows}) => setServerNotifications(rows)).catch(() => setServerNotifications([]))
  }, [user])

  const filteredItems = useMemo(() => items.filter(item =>
    (filter === 'All' || item.status === filter) &&
    `${item.name} ${item.place} ${item.category}`.toLowerCase().includes(query.toLowerCase())
  ), [items, filter, query])

  const notify = (message: string) => {
    setToast(message)
    window.setTimeout(() => setToast(''), 2800)
  }

  const submitReport = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!user) {
      setAuthOpen(true)
      notify('Please sign in before submitting a campus report.')
      return
    }
    const form = new FormData(event.currentTarget)
    form.set('status', reportType)
    try {
      const { item } = await createItem(form)
      setItems(current => [{ id: item.id, name: item.name, category: item.category, place: item.place, date: item.date, status: item.status, match: item.match || 0, image: item.image || '' }, ...current])
      setShowModal(false)
      setPage('Lost & Found')
      notify(`${reportType} item report saved to MongoDB`)
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
    <div className="app-shell">
      <aside className={`sidebar ${mobileNav ? 'sidebar-open' : ''}`}>
        <div className="brand"><div className="brand-mark"><Compass size={21}/></div><span>Campus<span className="brand-accent">Connect</span></span></div>
        <div className="campus-label">YOUR CAMPUS</div>
        <nav>
          {nav.map(({ label, icon: Icon }) => (
            <button key={label} className={`nav-item ${page === label ? 'active' : ''}`} onClick={() => { setPage(label); setMobileNav(false) }}>
              <Icon size={18}/><span>{label}</span>{label === 'Notifications' && <i className="nav-dot"/>}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="help-card"><div className="help-icon"><CircleHelp size={18}/></div><b>Need a hand?</b><p>Find answers about campus services.</p><button onClick={() => notify('Help centre coming soon')}>Visit help centre <ArrowRight size={14}/></button></div>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <button className="mobile-menu icon-button" onClick={() => setMobileNav(!mobileNav)}><Menu size={20}/></button>
          <div className="crumb">UEM Kolkata <span>/</span> <b>{page}</b></div>
          <div className="top-actions">
            <button className="icon-button notification-button" onClick={() => setPage('Notifications')} aria-label="Notifications"><Bell size={19}/><i/></button>
            {user ? <button className="top-avatar" title={`Signed in as ${user.name} · Sign out`} onClick={() => { logout(); setUser(null); notify('Signed out') }}>{user.name.slice(0,2).toUpperCase()}</button> : <button className="soft-button" onClick={() => setAuthOpen(true)}>Sign in</button>}
          </div>
        </header>

        <div className="content">
          <div className={`connection-banner ${apiState}`}><span/> {apiState === 'connected' ? 'Connected to CampusConnect API · MongoDB data' : apiState === 'offline' ? 'Backend offline · live data unavailable' : 'Connecting to backend…'}</div>
          {page === 'Overview' && <Overview items={items} setPage={setPage} onReport={() => { if (!user) { setAuthOpen(true); notify('Sign in to submit a report.'); return } setShowModal(true) }} notify={notify}/>}
          {page === 'Lost & Found' && <LostFound items={filteredItems} query={query} setQuery={setQuery} filter={filter} setFilter={setFilter} onReport={(type) => { if (!user) { setAuthOpen(true); notify('Sign in to submit a report.'); return } setReportType(type); setShowModal(true) }} notify={notify} onClaim={async (id) => { if (!user) { setAuthOpen(true); return } try { const result = await requestItemClaim(id); notify(result.message) } catch (error) { notify(error instanceof Error ? error.message : 'Claim request failed') } }} onFindMatches={async (id) => { try { const result = await getItemMatches(id); setMatchResults(result.matches); setMatchMode(result.aiMode); setMatchesOpen(true) } catch (error) { notify(error instanceof Error ? error.message : 'Could not find matches') } }}/>}
          {page === 'Shuttle Tracker' && <Shuttle notify={notify} user={user}/>}
          {page === 'Campus Insights' && <Insights items={items}/>}
          {page === 'Notifications' && <NotificationsView rows={serverNotifications} signedIn={!!user} onSignIn={() => setAuthOpen(true)} onMarkRead={async () => { try { await markAllNotificationsRead(); setServerNotifications(rows => rows.map(row => ({...row, read:true}))); notify('All notifications marked as read') } catch (error) { notify(error instanceof Error ? error.message : 'Could not update notifications') } }}/>} 
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
      <Stat icon={<Clock3/>} tone="orange" label="Average shuttle ETA" value="—" change="ETA feed not available"/>
    </section>
    <section className="dashboard-grid">
      <div className="panel recent-panel"><div className="panel-head"><div><h3>Recent campus reports</h3><p>Latest reports saved in the database.</p></div><button className="text-button" onClick={() => setPage('Lost & Found')}>View all <ArrowRight size={15}/></button></div>
        {recentItems.length ? recentItems.map(item => <div className="match-row" key={item.id}><div className="match-placeholder"><PackageSearch size={22}/></div><div className="match-info"><b>{item.name}</b><span><MapPin size={13}/> {item.place} · {item.date}</span><small>{item.category} · {item.status}</small></div></div>) : <p className="empty-state">No campus reports have been submitted yet.</p>}
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

function LostFound({items, query, setQuery, filter, setFilter, onReport, notify, onClaim, onFindMatches}: {items: Item[], query: string, setQuery: (s:string)=>void, filter:string, setFilter:(s:string)=>void, onReport:(t:'Lost'|'Found')=>void, notify:(s:string)=>void, onClaim:(id:string|number)=>void, onFindMatches:(id:string|number)=>void}) {
  return <>
    <PageHeading eyebrow="COMMUNITY RECOVERY" title="Lost & Found" subtitle="A little help from AI can bring your belongings back." action={<button className="primary-button" onClick={() => onReport('Lost')}><Plus size={17}/> Create a report</button>}/>
    <div className="feature-strip"><div className="feature-spark"><Sparkles/></div><div><b>AI-assisted matching is on</b><p>We compare image, description and location signals to surface likely matches.</p></div><span className="feature-tag">BETA</span></div>
    <div className="toolbar"><div className="search-box"><Search size={17}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search items, places or categories..."/></div><div className="filter-group"><Filter size={16}/>{['All','Lost','Found'].map(f=><button key={f} className={filter===f?'selected':''} onClick={()=>setFilter(f)}>{f}</button>)}</div></div>
    <div className="section-title compact"><div><h2>Community reports</h2><p>{items.length} reports matching your view.</p></div><div className="report-buttons"><button className="outline-button" onClick={()=>onReport('Lost')}>I lost something</button><button className="primary-button" onClick={()=>onReport('Found')}><Plus size={16}/> I found something</button></div></div>
    <div className="items-grid">{items.length ? items.map(item=><article className="item-card" key={item.id}><div className="item-image">{item.image ? <img src={item.image} alt={item.name}/> : <div className="match-placeholder"><PackageSearch size={28}/></div>}<span className={`status-badge ${item.status.toLowerCase()}`}>{item.status}</span>{item.match>0&&<span className="similarity"><Sparkles size={12}/>{item.match}% match</span>}</div><div className="item-body"><div className="item-category">{item.category}</div><h3>{item.name}</h3><p><MapPin size={13}/>{item.place}</p><div className="item-foot"><span>{item.date}</span><button onClick={()=>item.status==='Lost'?onFindMatches(item.id):onClaim(item.id)}>{item.status==='Lost'?'Find matches':'Request claim'} <ArrowRight size={14}/></button></div></div></article>) : <p className="empty-state">No reports found. Create the first campus report.</p>}</div>
  </>
}

function Shuttle({notify, user}: {notify:(s:string)=>void; user:AppUser|null}) {
  const [gpsSharing, setGpsSharing] = useState(false)
  const [gpsError, setGpsError] = useState('')
  const [gpsStatus, setGpsStatus] = useState('Not sharing')
  const gpsWatchId = useRef<number|null>(null)
  const startGps = () => {
    if (user?.role !== 'driver' && user?.role !== 'admin') { notify('Sign in with a Driver account to share shuttle GPS'); return }
    if (!navigator.geolocation) { setGpsError('Geolocation is not supported by this browser'); return }
    const watchId = navigator.geolocation.watchPosition(async position => {
      try {
        if (!selectedRoute) { setGpsError('No shuttle route is selected'); return }
        await updateShuttleLocation(selectedRoute, {
          latitude: position.coords.latitude, longitude: position.coords.longitude,
          heading: position.coords.heading ?? undefined, speedKmph: position.coords.speed ? position.coords.speed * 3.6 : undefined
        })
        setGpsStatus(`Last sent ${new Date().toLocaleTimeString()}`)
        setGpsError('')
      } catch (error) { setGpsError(error instanceof Error ? error.message : 'Could not send GPS update') }
    }, error => setGpsError(error.message), { enableHighAccuracy:true, maximumAge:5000, timeout:15000 })
    gpsWatchId.current = watchId
    setGpsSharing(true)
    setGpsStatus('Waiting for GPS permission…')
  }
  const stopGps = () => {
    if (gpsWatchId.current !== null) navigator.geolocation.clearWatch(gpsWatchId.current)
    gpsWatchId.current = null; setGpsSharing(false); setGpsStatus('Not sharing')
  }
  useEffect(() => () => { if (gpsWatchId.current !== null) navigator.geolocation.clearWatch(gpsWatchId.current) }, [])
  const [routes, setRoutes] = useState<ShuttleData[]>([])
  const [selectedRoute, setSelectedRoute] = useState('')
  const [lastUpdate, setLastUpdate] = useState<string>('')
  useEffect(() => {
    getShuttles().then(({shuttles}) => { setRoutes(shuttles); if (shuttles.length) setSelectedRoute(shuttles[0].code) }).catch(() => setRoutes([]))
    const socket = io(socketUrl, { transports: ['websocket', 'polling'] })
    socket.emit('shuttle:subscribe', selectedRoute || 'R1')
    socket.on('shuttle:location', (shuttle: ShuttleData) => {
      setRoutes(current => current.map(route => route.code === shuttle.code ? shuttle : route))
      setLastUpdate(new Date().toLocaleTimeString())
    })
    socket.on('shuttle:stale', ({code}: {code:string}) => notify(`${code} GPS signal is stale`))
    return () => { socket.disconnect() }
  }, [])
  const routeRows: string[][] = routes.map(route => [route.code, route.origin, route.destination, route.latitude != null && route.longitude != null ? 'GPS live' : 'Waiting', route.lastGpsAt ? 'GPS active' : 'Awaiting GPS'])
  return <>
    <PageHeading eyebrow="CAMPUS MOBILITY" title="Shuttle tracker" subtitle="Know where your ride is, before you head out." action={<span className="live-status"><i/> SOCKET.IO READY</span>}/>
    {user?.role === 'driver' || user?.role === 'admin' ? <div className="driver-console"><div><b>Driver GPS beacon · Selected route</b><small>{gpsStatus}{gpsError ? ` · ${gpsError}` : ''}</small></div><button className={gpsSharing?'outline-button':'primary-button'} onClick={gpsSharing?stopGps:startGps}>{gpsSharing?'Stop sharing':'Start GPS sharing'}</button></div> : <div className="driver-console"><div><b>Want to share a shuttle location?</b><small>Sign in or register with the Driver role on the top-right account menu, then allow location access.</small></div></div>}
    <div className="shuttle-layout">
      <div className="panel route-list"><div className="panel-head"><div><h3>Campus routes</h3><p>Choose a route to see its journey.</p></div><button className="icon-button" onClick={()=>notify('Routes refreshed')}><Activity size={17}/></button></div>
        {routeRows.length ? routeRows.map((r)=><button className={`route-option ${selectedRoute===r[0]?'route-active':''}`} key={r[0]} onClick={()=>{setSelectedRoute(r[0]);notify(`${r[0]} selected`)}}><div className="route-code">{r[0]}</div><div className="route-option-text"><b>{r[1]} <ArrowRight size={12}/> {r[2]}</b><small>{r[4]} · {r[3]}</small></div><div className="route-time">{r[3]==='GPS live'?'GPS':'—'}<small>status</small></div></button>) : <p className="empty-state">No routes are configured in the database yet.</p>}
        <div className="driver-note"><ShieldCheck size={17}/><span><b>Location privacy</b><small>Driver location is shared only while on an active route.</small></span></div>
      </div>
      <div className="map-panel"><div className="map-top"><div><b>Route {selectedRoute} · Live location</b><span><i/> {lastUpdate ? `Updated ${lastUpdate}` : 'Waiting for driver GPS'}</span></div></div>{(() => { const route = routes.find(row => row.code === selectedRoute); return route && route.latitude != null && route.longitude != null ? <div className="empty-state">GPS coordinates received: {route.latitude.toFixed(5)}, {route.longitude.toFixed(5)}</div> : <div className="empty-state">No live GPS coordinates are available for this route.</div> })()}</div>
    </div>
    <div className="section-title compact"><div><h2>Registered routes</h2><p>Route and GPS status received from the backend. Arrival estimates are not available.</p></div><span className="updated-label">{routes.length ? 'Socket.IO updates enabled' : 'No backend routes'}</span></div>
    <div className="arrival-table"><div className="arrival-head"><span>ROUTE</span><span>DESTINATION</span><span>GPS</span><span>LAST UPDATE</span></div>{routes.length ? routes.map(route => <div className="arrival-row" key={route._id}><b>{route.code}</b><span>{route.destination}</span><strong>{route.latitude != null && route.longitude != null ? 'Available' : '—'}</strong><span>{route.lastGpsAt ? new Date(route.lastGpsAt).toLocaleString() : 'No update'}</span></div>) : <p className="empty-state">No shuttle route data is available.</p>}</div>
  </>
}


function Insights({items}: {items: Item[]}) {
  const recovered = items.filter(item => item.status === 'Claimed' || item.status === 'Resolved').length
  return <>
    <PageHeading eyebrow="CAMPUS INTELLIGENCE" title="Campus insights" subtitle="Insights calculated from real campus reports."/>
    <div className="stats-grid insight-stats">
      <Stat icon={<PackageSearch/>} tone="purple" label="Total reports" value={items.length} change="Saved in the database"/>
      <Stat icon={<ShieldCheck/>} tone="green" label="Items recovered" value={recovered} change="Claimed or resolved"/>
    </div>
    <div className="panel">
      <div className="panel-head"><div><h3>Analytics availability</h3><p>Only metrics supported by current backend data are displayed.</p></div></div>
      <p className="empty-state">Location heatmaps, recovery trends and shuttle trip analytics are not connected to the backend yet. They will appear here when analytics data is available.</p>
    </div>
  </>
}

function NotificationsView({rows, signedIn, onSignIn, onMarkRead}: {rows:ApiNotification[]; signedIn:boolean; onSignIn:()=>void; onMarkRead:()=>void}) {
  const shown = signedIn ? rows.map(n=>({id:n._id,title:n.title,detail:n.message,time:new Date(n.createdAt).toLocaleString(),type:n.type,unread:!n.read})) : [];
  return <>
    <PageHeading eyebrow="STAY IN THE LOOP" title="Notifications" subtitle="The updates that matter to your campus day." action={signedIn ? <button className="outline-button" onClick={onMarkRead}>Mark all as read</button> : <button className="outline-button" onClick={onSignIn}>Sign in to sync</button>}/>
    {!signedIn && <div className="feature-strip"><div className="feature-spark"><Bell/></div><div><b>Sign in to view notifications</b><p>Notifications are linked to your account. Sample notifications are not displayed.</p></div></div>}
    <div className="notification-list">{shown.length ? shown.map(n=><div className={`notification-card ${n.unread?'unread':''}`} key={n.id}><div className={`notification-icon ${n.type}`}>{n.type==='match'?<Sparkles/>:n.type==='bus'?<Bus/>:<Activity/>}</div><div className="notification-copy"><b>{n.title}</b><p>{n.detail}</p><small>{n.time}</small></div>{n.unread&&<span className="unread-dot"/>}</div>) : <p className="empty-state">{signedIn ? 'You have no notifications yet.' : 'Your account notifications will appear here after sign in.'}</p>}</div>
  </>
}

function ReportModal({type, setType, onClose, onSubmit}: {type:'Lost'|'Found', setType:(t:'Lost'|'Found')=>void, onClose:()=>void, onSubmit:(e:FormEvent<HTMLFormElement>)=>void}) {
  return <div className="modal-backdrop" onMouseDown={onClose}><div className="modal" onMouseDown={e=>e.stopPropagation()}><div className="modal-head"><div><div className="eyebrow">COMMUNITY REPORT</div><h2>Tell us about the item</h2><p>Share a few details so the community can help.</p></div><button className="icon-button" onClick={onClose}><X size={20}/></button></div><form onSubmit={onSubmit}><div className="segmented">{(['Lost','Found'] as const).map(t=><button type="button" className={type===t?'chosen':''} onClick={()=>setType(t)} key={t}>{t} item</button>)}</div><label>Item name<input name="name" required placeholder="e.g. Black laptop backpack"/></label><label>Category<select name="category"><option>Personal items</option><option>Electronics</option><option>Bags</option><option>Books & stationery</option><option>Accessories</option></select></label><label>Last seen / found location<input name="place" required placeholder="e.g. Central Library"/></label><label>Photo <div className="upload-box"><Upload size={19}/><span><b>Choose an item photo</b><small>JPEG, PNG or WEBP · up to 5 MB.</small></span><input type="file" name="image" accept="image/*" /></div></label><div className="modal-actions"><button type="button" className="outline-button" onClick={onClose}>Cancel</button><button className="primary-button" type="submit">Submit report <ArrowRight size={15}/></button></div></form></div></div>
}


function MatchesModal({rows, mode, onClose}: {rows:MatchResult[]; mode:string; onClose:()=>void}) {
  return <div className="modal-backdrop" onMouseDown={onClose}><div className="modal" onMouseDown={e=>e.stopPropagation()}><div className="modal-head"><div><div className="eyebrow">AI-ASSISTED SEARCH</div><h2>Potential matches</h2><p>Matching mode: {mode}. Scores rank candidates; they do not prove ownership.</p></div><button className="icon-button" onClick={onClose}><X size={20}/></button></div>{rows.length===0?<p className="empty-state">No possible matches found yet. Try again when more found-item reports are available.</p>:<div className="match-results">{rows.map(row=><div className="match-result" key={row.id}>{row.image ? <img src={row.image} alt={row.name}/> : <div className="match-placeholder"><PackageSearch size={24}/></div>}<div><b>{row.name}</b><small>{row.status} · {row.place}</small><small>Visual: {row.scoreBreakdown.visual===null?'Not available':`${row.scoreBreakdown.visual}%`} · Text: {row.scoreBreakdown.text}% · Location: {row.scoreBreakdown.location}%</small></div><strong>{row.score}%</strong></div>)}</div>}<div className="modal-actions"><button className="primary-button" onClick={onClose}>Close</button></div></div></div>
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
