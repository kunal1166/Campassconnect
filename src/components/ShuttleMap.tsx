import { useEffect, useRef, useState } from 'react'
import {
  APIProvider,
  APILoadingStatus,
  AdvancedMarker,
  InfoWindow,
  Map as GoogleMap,
  Pin,
  useAdvancedMarkerRef,
  useApiLoadingStatus,
  useMap,
  useMapsLibrary,
} from '@vis.gl/react-google-maps'
import { getMapsConfig, type ShuttleData } from '../services/api'

interface CampusStopPin {
  id: string
  name: string
  address: string
  position: google.maps.LatLngLiteral
}

export interface RouteEtaInfo {
  distanceKm: string
  durationMin: number
}

interface ShuttleMapProps {
  routes: ShuttleData[]
  selectedRouteCode: string
  staleRoutes?: Record<string, boolean>
  onRouteEtaChange?: (code: string, info: RouteEtaInfo | null) => void
}

function isQuotaError(err: unknown): boolean {
  const text = err instanceof Error ? err.message : String(err)
  return (
    text.includes('OVER_QUERY_LIMIT') ||
    text.includes('RESOURCE_EXHAUSTED') ||
    text.includes('429') ||
    text.includes('Quota')
  )
}

function StopMarker({ stop }: { stop: CampusStopPin }) {
  const [markerRef, marker] = useAdvancedMarkerRef()
  const [open, setOpen] = useState(false)

  return (
    <>
      <AdvancedMarker
        ref={markerRef}
        position={stop.position}
        title={stop.name}
        onClick={() => setOpen(true)}
      >
        <Pin background="#35b887" borderColor="#1f8a62" glyphColor="#ffffff" scale={0.95} />
      </AdvancedMarker>
      {open && marker && (
        <InfoWindow anchor={marker} maxWidth={230} onCloseClick={() => setOpen(false)}>
          <div style={{ fontSize: '12px', lineHeight: 1.4 }}>
            <strong style={{ display: 'block', color: '#242642', marginBottom: '4px' }}>
              {stop.name}
            </strong>
            <span style={{ color: '#62667c' }}>{stop.address}</span>
          </div>
        </InfoWindow>
      )}
    </>
  )
}

function BusMarker({ route, isStale }: { route: ShuttleData; isStale: boolean }) {
  const [markerRef, marker] = useAdvancedMarkerRef()
  const [open, setOpen] = useState(false)
  const hasGps = route.latitude != null && route.longitude != null
  const [displayPos, setDisplayPos] = useState<google.maps.LatLngLiteral | null>(
    hasGps ? { lat: route.latitude!, lng: route.longitude! } : null
  )
  const prevTargetRef = useRef<google.maps.LatLngLiteral | null>(
    hasGps ? { lat: route.latitude!, lng: route.longitude! } : null
  )
  const animFrameRef = useRef<number | null>(null)

  useEffect(() => {
    if (animFrameRef.current !== null) {
      cancelAnimationFrame(animFrameRef.current)
      animFrameRef.current = null
    }
    if (route.latitude == null || route.longitude == null) {
      prevTargetRef.current = null
      setDisplayPos(null)
      return
    }
    const nextPos = { lat: route.latitude, lng: route.longitude }
    const startPos = prevTargetRef.current
    if (!startPos || (startPos.lat === nextPos.lat && startPos.lng === nextPos.lng)) {
      prevTargetRef.current = nextPos
      setDisplayPos(nextPos)
      return
    }

    const durationMs = 600
    const startTime = performance.now()
    const step = (now: number) => {
      const t = Math.min(1, (now - startTime) / durationMs)
      const eased = 1 - Math.pow(1 - t, 3)
      const lat = startPos.lat + (nextPos.lat - startPos.lat) * eased
      const lng = startPos.lng + (nextPos.lng - startPos.lng) * eased
      setDisplayPos({ lat, lng })
      if (t < 1) {
        animFrameRef.current = requestAnimationFrame(step)
      } else {
        prevTargetRef.current = nextPos
        animFrameRef.current = null
      }
    }
    animFrameRef.current = requestAnimationFrame(step)

    return () => {
      if (animFrameRef.current !== null) {
        cancelAnimationFrame(animFrameRef.current)
        animFrameRef.current = null
      }
      prevTargetRef.current = nextPos
    }
  }, [route.latitude, route.longitude])

  if (!hasGps || !displayPos) return null

  return (
    <>
      <AdvancedMarker
        ref={markerRef}
        position={displayPos}
        title={`Shuttle ${route.code}: ${route.routeName}`}
        onClick={() => setOpen(true)}
      >
        <Pin
          background={isStale ? '#d9a14d' : '#7657e8'}
          borderColor={isStale ? '#9c6e24' : '#4d35b3'}
          glyphColor="#ffffff"
          glyphText={route.code}
          scale={1.15}
        />
      </AdvancedMarker>
      {open && marker && (
        <InfoWindow anchor={marker} maxWidth={250} onCloseClick={() => setOpen(false)}>
          <div style={{ fontSize: '12px', lineHeight: 1.4 }}>
            <strong style={{ display: 'block', color: '#242642', marginBottom: '4px' }}>
              Route {route.code} · {route.routeName}
            </strong>
            <div style={{ color: '#62667c' }}>
              {route.origin} → {route.destination}
            </div>
            <div style={{ color: isStale ? '#ad7837' : '#7657e8', marginTop: '4px', fontWeight: 600 }}>
              {route.latitude!.toFixed(5)}, {route.longitude!.toFixed(5)}
              {route.speedKmph != null ? ` · ${Math.round(route.speedKmph)} km/h` : ''}
            </div>
            <div style={{ color: '#85899b', fontSize: '11px', marginTop: '2px' }}>
              {isStale ? 'Stale GPS signal' : 'Live GPS'}
              {route.lastGpsAt ? ` · ${new Date(route.lastGpsAt).toLocaleTimeString()}` : ''}
            </div>
          </div>
        </InfoWindow>
      )}
    </>
  )
}

function ShuttleMapScene({
  routes,
  selectedRouteCode,
  staleRoutes = {},
  onRouteEtaChange,
}: ShuttleMapProps) {
  const map = useMap()
  const loadingStatus = useApiLoadingStatus()
  const placesLib = useMapsLibrary('places')
  const routesLib = useMapsLibrary('routes')

  const [stops, setStops] = useState<CampusStopPin[]>([])
  const [campusCenter, setCampusCenter] = useState<google.maps.LatLngLiteral | null>(null)
  const [routeInfo, setRouteInfo] = useState<RouteEtaInfo | null>(null)
  const [mapError, setMapError] = useState('')
  const [placesNotice, setPlacesNotice] = useState('')
  const polylinesRef = useRef<google.maps.Polyline[]>([])
  const lastZoomedRouteRef = useRef<string>('')

  const activeRoute = routes.find((r) => r.code === selectedRouteCode) || routes[0]
  const isActiveStale = activeRoute ? Boolean(staleRoutes[activeRoute.code]) : false

  useEffect(() => {
    if (loadingStatus === APILoadingStatus.AUTH_FAILURE) {
      window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'))
      setMapError('Unable to authorize Google Maps Platform for this session.')
    } else if (loadingStatus === APILoadingStatus.FAILED) {
      setMapError('Unable to load Google Maps JavaScript API.')
    } else if (loadingStatus === APILoadingStatus.LOADED) {
      setMapError('')
    }
  }, [loadingStatus])

  // Discover real campus center and nearby transit/campus landmarks via Places API (New)
  useEffect(() => {
    if (!placesLib || !map) return
    let cancelled = false

    async function loadCampusPlaces() {
      try {
        const PlaceClass = (placesLib as unknown as {
          Place: {
            searchByText: (req: {
              textQuery: string
              fields: string[]
              maxResultCount?: number
            }) => Promise<{ places: Array<{ id?: string; displayName?: string; formattedAddress?: string; location?: google.maps.LatLng }> }>
          }
        }).Place

        const { places } = await PlaceClass.searchByText({
          textQuery: 'University of Engineering & Management Kolkata',
          fields: ['id', 'displayName', 'location', 'formattedAddress'],
          maxResultCount: 5,
        })

        if (cancelled) return

        const resolved: CampusStopPin[] = places
          .filter((p) => p.location)
          .map((p, idx) => ({
            id: p.id || `stop-${idx}`,
            name: p.displayName || 'Campus Point',
            address: p.formattedAddress || 'New Town, Kolkata',
            position: {
              lat: p.location!.lat(),
              lng: p.location!.lng(),
            },
          }))

        setStops(resolved)
        if (resolved.length > 0) {
          setPlacesNotice('')
          setCampusCenter(resolved[0].position)
          if (!(activeRoute?.latitude != null && activeRoute?.longitude != null)) {
            map?.panTo(resolved[0].position)
            map?.setZoom(15)
          }
        } else {
          setPlacesNotice('Campus location lookup returned no matches. Map will center when a shuttle shares live GPS.')
        }
      } catch (err) {
        if (isQuotaError(err)) {
          window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'))
        }
        console.error('Places searchByText failed:', err)
        if (!cancelled) {
          setPlacesNotice('Campus location lookup unavailable (check Places API (New) permissions or quota).')
        }
      }
    }

    loadCampusPlaces()
    return () => {
      cancelled = true
    }
  }, [placesLib, map])

  // Pan smoothly to live shuttle GPS when driver shares coordinates; only reset zoom on route switch or first GPS lock
  useEffect(() => {
    if (!map || !activeRoute) return
    if (activeRoute.latitude != null && activeRoute.longitude != null) {
      const pos = { lat: activeRoute.latitude, lng: activeRoute.longitude }
      map.panTo(pos)
      if (lastZoomedRouteRef.current !== activeRoute.code) {
        map.setZoom(16)
        lastZoomedRouteRef.current = activeRoute.code
      }
    } else if (lastZoomedRouteRef.current === activeRoute.code) {
      lastZoomedRouteRef.current = ''
    }
  }, [map, activeRoute?.code, activeRoute?.latitude, activeRoute?.longitude])

  // Compute route polyline and traffic-aware ETA via Routes API ONLY when active shuttle has live, non-stale GPS
  useEffect(() => {
    polylinesRef.current.forEach((p) => p.setMap(null))
    polylinesRef.current = []
    setRouteInfo(null)
    if (activeRoute) {
      onRouteEtaChange?.(activeRoute.code, null)
    }

    if (
      !map ||
      !routesLib ||
      !activeRoute ||
      activeRoute.latitude == null ||
      activeRoute.longitude == null ||
      isActiveStale ||
      !activeRoute.destination
    ) {
      return
    }

    const originPos: google.maps.LatLngLiteral = {
      lat: activeRoute.latitude,
      lng: activeRoute.longitude,
    }
    const destinationQuery = activeRoute.destination

    let cancelled = false

    const RouteClass = (routesLib as unknown as {
      Route?: {
        computeRoutes: (req: Record<string, unknown>) => Promise<{
          routes: Array<{
            distanceMeters?: number
            durationMillis?: number
            viewport?: google.maps.LatLngBounds
            createPolylines: () => google.maps.Polyline[]
          }>
        }>
      }
    }).Route

    if (!RouteClass?.computeRoutes) return

    RouteClass.computeRoutes({
      origin: originPos,
      destination: destinationQuery,
      travelMode: 'DRIVING',
      fields: ['path', 'distanceMeters', 'durationMillis', 'viewport'],
    })
      .then(({ routes: computed }) => {
        if (cancelled || !computed || computed.length === 0) {
          if (!cancelled) onRouteEtaChange?.(activeRoute.code, null)
          return
        }
        const primary = computed[0]
        const lines = primary.createPolylines()
        lines.forEach((line) => {
          line.setOptions({
            strokeColor: '#b9a9f5',
            strokeOpacity: 0.95,
            strokeWeight: 5,
          })
          line.setMap(map)
        })
        polylinesRef.current = lines

        if (primary.distanceMeters != null && primary.durationMillis != null && primary.durationMillis > 0) {
          const info: RouteEtaInfo = {
            distanceKm: (primary.distanceMeters / 1000).toFixed(2),
            durationMin: Math.max(1, Math.round(primary.durationMillis / 60000)),
          }
          setRouteInfo(info)
          onRouteEtaChange?.(activeRoute.code, info)
        } else {
          onRouteEtaChange?.(activeRoute.code, null)
        }
      })
      .catch((err) => {
        if (isQuotaError(err)) {
          window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'))
        }
        console.warn('Route ETA calculation unavailable:', err)
        if (!cancelled) onRouteEtaChange?.(activeRoute.code, null)
      })

    return () => {
      cancelled = true
      polylinesRef.current.forEach((p) => p.setMap(null))
      polylinesRef.current = []
    }
  }, [map, routesLib, activeRoute?.code, activeRoute?.latitude, activeRoute?.longitude, activeRoute?.destination, isActiveStale, campusCenter])

  return (
    <>
      {mapError && (
        <div className="empty-state" style={{ marginBottom: '10px', color: '#b42318', background: '#fff1f0' }}>
          {mapError}
        </div>
      )}
      {!mapError && placesNotice && activeRoute?.latitude == null && (
        <div className="empty-state" style={{ marginBottom: '10px' }}>
          {placesNotice}
        </div>
      )}
      <div className="campus-map" style={{ width: '100%', height: '350px' }}>
        <GoogleMap
          mapId="DEMO_MAP_ID"
          defaultCenter={{ lat: 0, lng: 0 }}
          defaultZoom={2}
          gestureHandling="greedy"
          streetViewControl={false}
          mapTypeControl={false}
          internalUsageAttributionIds={['gmp_mcp_codeassist_v1_aistudio']}
          style={{ width: '100%', height: '100%' }}
        >
          {stops.map((stop) => (
            <StopMarker key={stop.id} stop={stop} />
          ))}
          {routes.map((route) => (
            <BusMarker
              key={route._id || route.code}
              route={route}
              isStale={Boolean(staleRoutes[route.code])}
            />
          ))}
        </GoogleMap>
      </div>
      <div style={{ marginTop: '8px', fontSize: '11px', color: '#62667c' }}>
        {routeInfo ? (
          <>
            Calculated route to <strong>{activeRoute?.destination}</strong>:{' '}
            <strong>{routeInfo.distanceKm} km</strong> · <strong>~{routeInfo.durationMin} min ETA</strong>
          </>
        ) : (
          <span>ETA unavailable</span>
        )}
      </div>
    </>
  )
}

export function ShuttleMap({
  routes,
  selectedRouteCode,
  staleRoutes,
  onRouteEtaChange,
}: ShuttleMapProps) {
  const envKey = (import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined)?.trim() || ''
  const [apiKey, setApiKey] = useState(envKey)
  const [loadedConfig, setLoadedConfig] = useState(Boolean(envKey))

  useEffect(() => {
    if (envKey) return
    let active = true
    getMapsConfig()
      .then((cfg) => {
        if (active) {
          setApiKey(cfg.apiKey?.trim() || '')
          setLoadedConfig(true)
        }
      })
      .catch(() => {
        if (active) setLoadedConfig(true)
      })
    return () => {
      active = false
    }
  }, [envKey])

  if (!loadedConfig) {
    return <div className="empty-state">Loading Google Maps configuration…</div>
  }

  if (!apiKey) {
    return (
      <div className="empty-state">
        Google Maps API key is not configured for this environment. Enable Google Maps or set VITE_GOOGLE_MAPS_API_KEY to view the interactive shuttle map.
      </div>
    )
  }

  return (
    <APIProvider
      apiKey={apiKey}
      libraries={['marker', 'places', 'routes']}
      language="en"
      region="IN"
    >
      <ShuttleMapScene
        routes={routes}
        selectedRouteCode={selectedRouteCode}
        staleRoutes={staleRoutes}
        onRouteEtaChange={onRouteEtaChange}
      />
    </APIProvider>
  )
}
