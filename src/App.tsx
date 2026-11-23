import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import {
  Activity, ArrowDownRight, ArrowRight, Bell, Bus, Check, ChevronDown, CircleHelp,
  Clock3, Compass, Filter, Grid2X2, MapPin, Menu, Plus, Search, Settings, ShieldCheck,
  Sparkles, TrendingUp, Upload, UserRound, WalletCards, X, PackageSearch, Route, ChartNoAxesCombined
} from 'lucide-react'
import { items as initialItems, notifications as demoNotifications } from './data/mock'
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
      setItems(rows.map(row => ({ id: row.id, name: row.name, category: row.category, place: row.place, date: row.date, status: row.status, match: row.match || 0, image: row.image || 'https://images.unsplash.com/photo-1553062407-98eeb64c6a62?w=700' })))
      setApiState('connected')
    }).catch(() => { setItems(initialItems); setApiState('offline') })
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
    const form = new FormData(event.currentTarget)
    form.set('status', reportType)
    try {
      const { item } = await createItem(form)
      setItems(current => [{ id: item.id, name: item.name, category: item.category, place: item.place, date: item.date, status: item.status, match: item.match || 0, image: item.image || 'https://images.unsplash.com/photo-1553062407-98eeb64c6a62?w=700' }, ...current])
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
            {user ? <button className="top-avatar" title="Sign out" onClick={() => { logout(); setUser(null); notify('Signed out') }}>{user.name.slice(0,2).toUpperCase()}</button> : <button className="soft-button" onClick={() => setAuthOpen(true)}>Sign in</button>}
          </div>
        </header>

        <div className="content">
          <div className={`connection-banner ${apiState}`}><span/> {apiState === 'connected' ? 'Connected to CampusConnect API · MongoDB data' : apiState === 'offline' ? 'Backend offline · showing demo data' : 'Connecting to backend…'}</div>
          {page === 'Overview' && <Overview setPage={setPage} onReport={() => setShowModal(true)} notify={notify}/>}
          {page === 'Lost & Found' && <LostFound items={filteredItems} query={query} setQuery={setQuery} filter={filter} setFilter={setFilter} onReport={(type) => {setReportType(type); setShowModal(true)}} notify={notify} onClaim={async (id) => { if (!user) { setAuthOpen(true); return } try { const result = await requestItemClaim(id); notify(result.message) } catch (error) { notify(error instanceof Error ? error.message : 'Claim request failed') } }} onFindMatches={async (id) => { try { const result = await getItemMatches(id); setMatchResults(result.matches); setMatchMode(result.aiMode); setMatchesOpen(true) } catch (error) { notify(error instanceof Error ? error.message : 'Could not find matches') } }}/>}
          {page === 'Shuttle Tracker' && <Shuttle notify={notify} user={user}/>}
          {page === 'Campus Insights' && <Insights/>}
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

function Overview({setPage, onReport, notify}: {setPage: (p: Page)=>void, onReport: ()=>void, notify: (s:string)=>void}) {
  return <>
    <section className="welcome-row"><div><div className="eyebrow">SUNDAY, 15 NOVEMBER 2026</div><h1>Welcome to CampusConnect</h1><p>Your campus, a little more connected.</p></div><button className="soft-button" onClick={() => notify('Campus guide coming soon')}><MapPin size={16}/> UEM Kolkata <ChevronDown size={15}/></button></section>
    <section className="hero-banner">
      <div className="hero-copy"><div className="hero-pill"><Sparkles size={13}/> YOUR SMART CAMPUS COMPANION</div><h2>Make campus life<br/><em>effortlessly connected.</em></h2><p>Find what matters. Get where you need to go. All in one place.</p><div className="hero-actions"><button className="button-white" onClick={() => setPage('Lost & Found')}>Explore Lost & Found <ArrowRight size={16}/></button><button className="hero-link" onClick={() => setPage('Shuttle Tracker')}>Track a shuttle</button></div></div>
      <div className="hero-art"><div className="orbit orbit-one"/><div className="orbit orbit-two"/><div className="hero-pin"><Bus size={31}/></div><div className="floating-chip chip-top"><span className="live-pulse"/> Shuttle R1 · 4 min</div><div className="floating-chip chip-bottom"><Sparkles size={15}/> AI found a possible match</div></div>
    </section>
    <div className="section-title"><div><h2>Your campus at a glance</h2><p>A quick snapshot of what's happening today.</p></div><span className="live-status"><i/> LIVE CAMPUS</span></div>
    <section className="stats-grid">
      <Stat icon={<PackageSearch/>} tone="purple" label="Open lost reports" value="18" change="4 new this week"/>
      <Stat icon={<ShieldCheck/>} tone="green" label="Items reunited" value="136" change="+12% this month"/>
      <Stat icon={<Bus/>} tone="blue" label="Shuttles active" value="3" change="Across 3 routes"/>
      <Stat icon={<Clock3/>} tone="orange" label="Average shuttle ETA" value="6 min" change="Across active routes"/>
    </section>
    <section className="dashboard-grid">
      <div className="panel recent-panel"><div className="panel-head"><div><h3>Recent AI matches</h3><p>Items that may be connected to your reports.</p></div><button className="text-button" onClick={() => setPage('Lost & Found')}>View all <ArrowRight size={15}/></button></div>
        <div className="match-row"><img src="https://images.unsplash.com/photo-1553062407-98eeb64c6a62?w=300" alt="Black backpack"/><div className="match-info"><b>Black laptop backpack</b><span><MapPin size={13}/> Central Library · Found today</span><small><Sparkles size={13}/> Strong visual similarity</small></div><div className="match-score">94%<small>match</small></div></div>
        <div className="match-row"><img src="https://images.unsplash.com/photo-1602143407151-7111542de6e8?w=300" alt="Water bottle"/><div className="match-info"><b>Blue water bottle</b><span><MapPin size={13}/> Cafeteria · Yesterday</span><small><Sparkles size={13}/> Similar colour and shape</small></div><div className="match-score">88%<small>match</small></div></div>
      </div>
      <div className="panel shuttle-panel"><div className="panel-head"><div><h3>Next shuttle</h3><p>Your nearby campus routes.</p></div><span className="live-status"><i/> LIVE</span></div><div className="route-card"><div className="route-icon"><Bus size={20}/></div><div className="route-main"><b>Route R1</b><span>Main Gate <ArrowRight size={12}/> Academic Block</span></div><div className="route-eta">4 <small>min</small></div></div><div className="route-progress"><span/></div><div className="route-foot"><span><MapPin size={13}/> 2 stops away</span><button className="text-button" onClick={() => setPage('Shuttle Tracker')}>Track bus <ArrowRight size={14}/></button></div></div>
    </section>
    <div className="quick-actions"><button onClick={onReport}><span className="quick-icon purple"><Plus/></span><span><b>Report an item</b><small>Lost something or found it?</small></span><ArrowRight size={17}/></button><button onClick={() => setPage('Shuttle Tracker')}><span className="quick-icon blue"><Bus/></span><span><b>Find my shuttle</b><small>Live routes and arrival times</small></span><ArrowRight size={17}/></button><button onClick={() => setPage('Campus Insights')}><span className="quick-icon orange"><Activity/></span><span><b>Campus insights</b><small>Explore campus activity</small></span><ArrowRight size={17}/></button></div>
  </>
}

function Stat({icon, tone, label, value, change}: {icon: ReactNode, tone: string, label: string, value: string, change: string}) {
  return <div className="stat-card"><div className={`stat-icon ${tone}`}>{icon}</div><span>{label}</span><strong>{value}</strong><small><TrendingUp size={13}/>{change}</small></div>
}

function LostFound({items, query, setQuery, filter, setFilter, onReport, notify, onClaim, onFindMatches}: {items: Item[], query: string, setQuery: (s:string)=>void, filter:string, setFilter:(s:string)=>void, onReport:(t:'Lost'|'Found')=>void, notify:(s:string)=>void, onClaim:(id:string|number)=>void, onFindMatches:(id:string|number)=>void}) {
  return <>
    <PageHeading eyebrow="COMMUNITY RECOVERY" title="Lost & Found" subtitle="A little help from AI can bring your belongings back." action={<button className="primary-button" onClick={() => onReport('Lost')}><Plus size={17}/> Create a report</button>}/>
    <div className="feature-strip"><div className="feature-spark"><Sparkles/></div><div><b>AI-assisted matching is on</b><p>We compare image, description and location signals to surface likely matches.</p></div><span className="feature-tag">BETA</span></div>
    <div className="toolbar"><div className="search-box"><Search size={17}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search items, places or categories..."/></div><div className="filter-group"><Filter size={16}/>{['All','Lost','Found'].map(f=><button key={f} className={filter===f?'selected':''} onClick={()=>setFilter(f)}>{f}</button>)}</div></div>
    <div className="section-title compact"><div><h2>Community reports</h2><p>{items.length} reports matching your view.</p></div><div className="report-buttons"><button className="outline-button" onClick={()=>onReport('Lost')}>I lost something</button><button className="primary-button" onClick={()=>onReport('Found')}><Plus size={16}/> I found something</button></div></div>
    <div className="items-grid">{items.map(item=><article className="item-card" key={item.id}><div className="item-image"><img src={item.image} alt={item.name}/><span className={`status-badge ${item.status.toLowerCase()}`}>{item.status}</span>{item.match>0&&<span className="similarity"><Sparkles size={12}/>{item.match}% match</span>}</div><div className="item-body"><div className="item-category">{item.category}</div><h3>{item.name}</h3><p><MapPin size={13}/>{item.place}</p><div className="item-foot"><span>{item.date}</span><button onClick={()=>item.status==='Lost'?onFindMatches(item.id):onClaim(item.id)}>{item.status==='Lost'?'Find matches':'Request claim'} <ArrowRight size={14}/></button></div></div></article>)}</div>
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
        await updateShuttleLocation('R1', {
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
  const [selectedRoute, setSelectedRoute] = useState('R1')
  const [lastUpdate, setLastUpdate] = useState<string>('')
  useEffect(() => {
    getShuttles().then(({shuttles}) => setRoutes(shuttles)).catch(() => setRoutes([]))
    const socket = io(socketUrl, { transports: ['websocket', 'polling'] })
    socket.emit('shuttle:subscribe', 'R1')
    socket.on('shuttle:location', (shuttle: ShuttleData) => {
      setRoutes(current => current.map(route => route.code === shuttle.code ? shuttle : route))
      setLastUpdate(new Date().toLocaleTimeString())
    })
    socket.on('shuttle:stale', ({code}: {code:string}) => notify(`${code} GPS signal is stale`))
    return () => { socket.disconnect() }
  }, [])
  const routeRows = routes.length ? routes.map(route => [route.code, route.origin, route.destination, route.latitude != null ? 'Live' : 'Waiting', route.lastGpsAt ? 'GPS active' : 'Awaiting GPS']) : [['R1','Main Gate','Academic Block','4 min','Demo fallback'],['R2','Hostel','Cafeteria','9 min','Demo fallback'],['R3','Library','Auditorium','13 min','Demo fallback']]
  return <>
    <PageHeading eyebrow="CAMPUS MOBILITY" title="Shuttle tracker" subtitle="Know where your ride is, before you head out." action={<span className="live-status"><i/> SOCKET.IO READY</span>}/>
    {user?.role === 'driver' || user?.role === 'admin' ? <div className="driver-console"><div><b>Driver GPS beacon · Route R1</b><small>{gpsStatus}{gpsError ? ` · ${gpsError}` : ''}</small></div><button className={gpsSharing?'outline-button':'primary-button'} onClick={gpsSharing?stopGps:startGps}>{gpsSharing?'Stop sharing':'Start GPS sharing'}</button></div> : <div className="driver-console"><div><b>Want to share a shuttle location?</b><small>Sign in or register with the Driver role on the top-right account menu, then allow location access.</small></div></div>}
    <div className="shuttle-layout">
      <div className="panel route-list"><div className="panel-head"><div><h3>Campus routes</h3><p>Choose a route to see its journey.</p></div><button className="icon-button" onClick={()=>notify('Routes refreshed')}><Activity size={17}/></button></div>
        {routeRows.map((r,i)=><button className={`route-option ${selectedRoute===r[0]?'route-active':''}`} key={r[0]} onClick={()=>{setSelectedRoute(r[0]);notify(`${r[0]} selected`)}}><div className="route-code">{r[0]}</div><div className="route-option-text"><b>{r[1]} <ArrowRight size={12}/> {r[2]}</b><small><span className={String(r[4]).includes('stale')?'delayed':'on-time'}>● {r[4]}</span> · {r[3]}</small></div><div className="route-time">{r[3]==='Live'?'GPS':'—'}<small>status</small></div></button>)}
        <div className="driver-note"><ShieldCheck size={17}/><span><b>Location privacy</b><small>Driver location is shared only while on an active route.</small></span></div>
      </div>
      <div className="map-panel"><div className="map-top"><div><b>Route {selectedRoute} · Location feed</b><span><i/> {lastUpdate ? `Updated ${lastUpdate}` : 'Waiting for driver GPS'}</span></div><button className="map-layer" onClick={()=>notify('The campus route graphic is illustrative; real GPS coordinates are available from the driver feed.')}>Route schematic <ChevronDown size={14}/></button></div><CampusMap/><div className="map-legend"><span><i className="legend-bus"/> Illustrative route</span><span><i className="legend-stop"/> Campus stop</span><span><i className="legend-route"/> Route path</span></div></div>
    </div>
    <div className="section-title compact"><div><h2>Upcoming arrivals</h2><p>Estimated arrivals at Main Gate.</p></div><span className="updated-label">{routes.length ? 'Live Socket.IO updates enabled' : 'Demo routes · connect driver GPS to go live'}</span></div>
    <div className="arrival-table"><div className="arrival-head"><span>ROUTE</span><span>DESTINATION</span><span>ARRIVAL</span><span>STATUS</span></div>{[['R1','Academic Block','4 min','On time'],['R2','Cafeteria','9 min','Delayed'],['R3','Auditorium','13 min','On time']].map(r=><div className="arrival-row" key={r[0]}><b>{r[0]}</b><span>{r[1]}</span><strong>{r[2]}</strong><span className={r[3]==='Delayed'?'delayed':'on-time'}>● {r[3]}</span></div>)}</div>
  </>
}

function CampusMap() {
  return <div className="campus-map"><div className="map-grid"/><div className="map-water"/><div className="map-road road-a"/><div className="map-road road-b"/><div className="map-building b1">LIBRARY</div><div className="map-building b2">ACADEMIC<br/>BLOCK</div><div className="map-building b3">CAFETERIA</div><div className="map-building b4">HOSTEL</div><svg className="route-svg" viewBox="0 0 700 430" preserveAspectRatio="none"><path d="M75 340 C160 320 155 235 250 245 S360 320 420 225 S530 145 620 90" fill="none" stroke="#7657e8" strokeWidth="7" strokeLinecap="round" strokeDasharray="1 1"/></svg><div className="map-stop stop-one"><span/>Main Gate</div><div className="map-stop stop-two"><span/>Library</div><div className="map-stop stop-three"><span/>Academic Block</div><div className="bus-marker"><Bus size={20}/></div><div className="map-scale">100 m</div></div>
}

function Insights() {
  return <>
    <PageHeading eyebrow="CAMPUS INTELLIGENCE" title="Campus insights" subtitle="Small signals that help make campus life better." action={<button className="soft-button"><span className="live-dot"/> Last 30 days <ChevronDown size={14}/></button>}/>
    <div className="stats-grid insight-stats"><Stat icon={<PackageSearch/>} tone="purple" label="Lost reports" value="147" change="12% vs previous period"/><Stat icon={<ShieldCheck/>} tone="green" label="Items recovered" value="136" change="41% recovery rate improvement"/><Stat icon={<Clock3/>} tone="blue" label="Average recovery" value="3.8 days" change="36% faster"/><Stat icon={<Bus/>} tone="orange" label="Shuttle trips" value="1,284" change="Across 3 routes"/></div>
    <div className="dashboard-grid insights-grid"><div className="panel"><div className="panel-head"><div><h3>Where items are often reported</h3><p>Illustrative lost-item activity by campus area.</p></div><span className="mini-label">HOTSPOT VIEW</span></div><div className="heatmap"><div className="heat-building hb1">LIBRARY</div><div className="heat-building hb2">CAFETERIA</div><div className="heat-building hb3">AUDITORIUM</div><div className="heat-spot hs1"/><div className="heat-spot hs2"/><div className="heat-spot hs3"/><div className="heat-spot hs4"/><span className="heat-label hl1">High activity</span><span className="heat-label hl2">Moderate</span></div></div><div className="panel trend-panel"><div className="panel-head"><div><h3>Recovery trend</h3><p>Items successfully reunited.</p></div></div><div className="trend-number">86% <span><TrendingUp size={14}/> +8.4%</span></div><div className="bar-chart">{[35,48,42,63,58,76,69,88,81,95,85,100].map((h,i)=><div key={i} style={{height:`${h}%`}}/>)}</div><div className="chart-months"><span>Wk 1</span><span>Wk 2</span><span>Wk 3</span><span>Wk 4</span></div></div></div>
    <div className="insight-callout"><Sparkles size={19}/><div><b>One insight worth exploring</b><p>Library and cafeteria reports account for a large share of found-item submissions. Better signage and collection points may help reduce recovery time.</p></div></div>
  </>
}

function NotificationsView({rows, signedIn, onSignIn, onMarkRead}: {rows:ApiNotification[]; signedIn:boolean; onSignIn:()=>void; onMarkRead:()=>void}) {
  const shown = signedIn ? rows.map(n=>({id:n._id,title:n.title,detail:n.message,time:new Date(n.createdAt).toLocaleString(),type:n.type,unread:!n.read})) : demoNotifications;
  return <>
    <PageHeading eyebrow="STAY IN THE LOOP" title="Notifications" subtitle="The updates that matter to your campus day." action={signedIn ? <button className="outline-button" onClick={onMarkRead}>Mark all as read</button> : <button className="outline-button" onClick={onSignIn}>Sign in to sync</button>}/>
    {!signedIn && <div className="feature-strip"><div className="feature-spark"><Bell/></div><div><b>You're viewing sample notifications</b><p>Sign in to see notifications saved to your account.</p></div></div>}
    <div className="notification-list">{shown.map(n=><div className={`notification-card ${n.unread?'unread':''}`} key={n.id}><div className={`notification-icon ${n.type}`}>{n.type==='match'?<Sparkles/>:n.type==='bus'?<Bus/>:<Activity/>}</div><div className="notification-copy"><b>{n.title}</b><p>{n.detail}</p><small>{n.time}</small></div>{n.unread&&<span className="unread-dot"/>}</div>)}</div>
  </>
}

function ReportModal({type, setType, onClose, onSubmit}: {type:'Lost'|'Found', setType:(t:'Lost'|'Found')=>void, onClose:()=>void, onSubmit:(e:FormEvent<HTMLFormElement>)=>void}) {
  return <div className="modal-backdrop" onMouseDown={onClose}><div className="modal" onMouseDown={e=>e.stopPropagation()}><div className="modal-head"><div><div className="eyebrow">COMMUNITY REPORT</div><h2>Tell us about the item</h2><p>Share a few details so the community can help.</p></div><button className="icon-button" onClick={onClose}><X size={20}/></button></div><form onSubmit={onSubmit}><div className="segmented">{(['Lost','Found'] as const).map(t=><button type="button" className={type===t?'chosen':''} onClick={()=>setType(t)} key={t}>{t} item</button>)}</div><label>Item name<input name="name" required placeholder="e.g. Black laptop backpack"/></label><label>Category<select name="category"><option>Personal items</option><option>Electronics</option><option>Bags</option><option>Books & stationery</option><option>Accessories</option></select></label><label>Last seen / found location<input name="place" required placeholder="e.g. Central Library"/></label><label>Photo <div className="upload-box"><Upload size={19}/><span><b>Choose an item photo</b><small>JPEG, PNG or WEBP · up to 5 MB.</small></span><input type="file" name="image" accept="image/*" /></div></label><div className="modal-actions"><button type="button" className="outline-button" onClick={onClose}>Cancel</button><button className="primary-button" type="submit">Submit report <ArrowRight size={15}/></button></div></form></div></div>
}


function MatchesModal({rows, mode, onClose}: {rows:MatchResult[]; mode:string; onClose:()=>void}) {
  return <div className="modal-backdrop" onMouseDown={onClose}><div className="modal" onMouseDown={e=>e.stopPropagation()}><div className="modal-head"><div><div className="eyebrow">AI-ASSISTED SEARCH</div><h2>Potential matches</h2><p>Matching mode: {mode}. Scores rank candidates; they do not prove ownership.</p></div><button className="icon-button" onClick={onClose}><X size={20}/></button></div>{rows.length===0?<p className="empty-state">No possible matches found yet. Try again when more found-item reports are available.</p>:<div className="match-results">{rows.map(row=><div className="match-result" key={row.id}><img src={row.image || 'https://images.unsplash.com/photo-1553062407-98eeb64c6a62?w=300'} alt={row.name}/><div><b>{row.name}</b><small>{row.status} · {row.place}</small><small>Visual: {row.scoreBreakdown.visual===null?'Not available':`${row.scoreBreakdown.visual}%`} · Text: {row.scoreBreakdown.text}% · Location: {row.scoreBreakdown.location}%</small></div><strong>{row.score}%</strong></div>)}</div>}<div className="modal-actions"><button className="primary-button" onClick={onClose}>Close</button></div></div></div>
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
