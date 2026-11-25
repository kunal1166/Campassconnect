export function ShuttleMapLegend() {
  return (
    <div className="map-legend" role="list" aria-label="Shuttle map legend">
      <span role="listitem">
        <i className="legend-bus" aria-hidden="true" />
        Active bus
      </span>
      <span role="listitem">
        <i className="legend-stop" aria-hidden="true" />
        Shuttle stop
      </span>
      <span role="listitem">
        <i className="legend-route" aria-hidden="true" />
        Shuttle route
      </span>
    </div>
  )
}
