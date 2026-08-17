'use client'

import { useRef, useState } from 'react'

// B-107. PRD 01 §6.8: "map views have list equivalents". Here the list is not
// an equivalent, it is THE view — this map is decoration over a results page
// that already works, collapsed by default, and it plots exactly the rows the
// list rendered (`facility-search.ts` now carries the coordinates through, so
// the two cannot disagree about where a facility is).
//
// D-14 is untouched: geocoding still resolves from the bundled dataset with no
// network call. This buys tiles and markers and nothing else.

export type MapFacility = {
  id: string
  name: string
  /// One line of text, the same address the result card prints.
  address: string
  href: string
  /// Short enough to sit in a bubble — "$89", or "Full" when nothing rents.
  priceLabel: string
  latitude: number
  longitude: number
}

/// Zoom past which `fitBounds` should not go. One facility fits its own bounds
/// at maximum zoom, which lands the renter on a roof rather than a neighbourhood.
const MAX_FIT_ZOOM = 15

let scriptLoad: Promise<void> | undefined

/// Loaded on first open, never on page load. The script is billed per load, it
/// is third-party, and nobody who leaves the map closed should pay for either.
function loadMaps(apiKey: string): Promise<void> {
  scriptLoad ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement('script')
    const params = new URLSearchParams({
      key: apiKey,
      libraries: 'marker',
      v: 'weekly',
      loading: 'async',
    })
    script.src = `https://maps.googleapis.com/maps/api/js?${params}`
    script.async = true
    script.onload = () => resolve()
    script.onerror = () => {
      // Cleared so a second open retries. A blocked script on one attempt is
      // usually a network blip or an extension, not a permanent verdict.
      scriptLoad = undefined
      reject(new Error('Google Maps script failed to load'))
    }
    document.head.appendChild(script)
  })
  return scriptLoad
}

export function ResultsMap({
  facilities,
  apiKey,
  mapId,
}: {
  facilities: MapFacility[]
  apiKey: string
  mapId: string
}) {
  const container = useRef<HTMLDivElement>(null)
  const started = useRef(false)
  const [status, setStatus] = useState('')
  const [failed, setFailed] = useState(false)

  async function open(event: React.SyntheticEvent<HTMLDetailsElement>) {
    if (!event.currentTarget.open || started.current || !container.current) return
    started.current = true

    try {
      await loadMaps(apiKey)
      const { Map } = (await google.maps.importLibrary('maps')) as google.maps.MapsLibrary
      const { AdvancedMarkerElement } = (await google.maps.importLibrary(
        'marker',
      )) as google.maps.MarkerLibrary

      const map = new Map(container.current, {
        mapId,
        // Roadmap, stated rather than left to the vendor default, and with the
        // type control removed so it cannot be changed. 1.4.11 asks for 3:1
        // between the bubbles and what is behind them; a satellite or terrain
        // background is arbitrary imagery no marker colour can be guaranteed
        // against, so the background is fixed and the bubbles are chosen for it.
        mapTypeId: 'roadmap',
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false,
        // 2.1.2 in practice: 'cooperative' means a plain wheel scroll pages the
        // document as it always did, and zooming the map takes a deliberate
        // ctrl/⌘ + wheel or two fingers. Without it a renter scrolling past the
        // map gets trapped zooming it.
        gestureHandling: 'cooperative',
      })

      const bounds = new google.maps.LatLngBounds()
      for (const facility of facilities) {
        const position = { lat: facility.latitude, lng: facility.longitude }
        bounds.extend(position)
        new AdvancedMarkerElement({
          map,
          position,
          title: facility.name,
          // The bubble IS a link, not a pin that opens a popup on hover. It
          // goes in the tab order for free, it works on touch, it needs no
          // hover (the row forbids depending on one), and it reaches the same
          // page as the result card above — so the map is never the only route
          // to a facility, and never a worse one.
          content: priceBubble(facility),
        })
      }
      map.fitBounds(bounds, 48)

      google.maps.event.addListenerOnce(map, 'idle', () => {
        if ((map.getZoom() ?? 0) > MAX_FIT_ZOOM) map.setZoom(MAX_FIT_ZOOM)
      })

      // 4.1.3: panning and zooming changes which facilities are on screen, and
      // a sighted user sees that happen. `idle` fires once the movement settles,
      // so this announces the outcome rather than every intermediate frame.
      map.addListener('idle', () => {
        const view = map.getBounds()
        if (!view) return
        const visible = facilities.filter((f) =>
          view.contains({ lat: f.latitude, lng: f.longitude }),
        ).length
        setStatus(
          `${visible} of ${facilities.length} ${facilities.length === 1 ? 'facility' : 'facilities'} in view`,
        )
      })
    } catch {
      setFailed(true)
      setStatus('The map could not be loaded. Every facility is in the list above, nearest first.')
    }
  }

  return (
    <div className="mt-8">
      {/* A native <details>, the same treatment the facility page gives its
          embed, and for the same two reasons: the third-party script is not
          fetched until it is asked for, and a closed <details> keeps the map
          out of the tab order so nobody traverses it to reach the results. */}
      <details onToggle={open}>
        <summary className="border-input inline-flex min-h-11 cursor-pointer items-center rounded-md border px-4 text-sm font-medium">
          Show map
        </summary>
        <div
          ref={container}
          // Named, and a group rather than `role="application"` — application
          // takes a screen-reader out of browse mode for a control that offers
          // it nothing in exchange.
          role="group"
          aria-label={`Map of the ${facilities.length} ${facilities.length === 1 ? 'facility' : 'facilities'} listed above`}
          // Hidden on failure rather than left as an empty grey box, which is
          // the one thing worse than no map: it reads as still loading.
          hidden={failed}
          className="bg-muted mt-4 aspect-video w-full rounded-lg border"
        />
      </details>

      {/* Outside the <details>, and rendered unconditionally. A live region
          that is display:none at mount and revealed later is announced about as
          reliably as one inserted later — which is to say, not.

          It carries the failure message too, rather than a second paragraph
          saying the same thing beside it. Two copies is how a screen-reader
          user hears the sentence announced and then reads it again. */}
      <p role="status" className="text-muted-foreground mt-2 text-sm empty:mt-0">
        {status}
      </p>
    </div>
  )
}

function priceBubble(facility: MapFacility): HTMLElement {
  const link = document.createElement('a')
  link.href = facility.href
  link.textContent = facility.priceLabel
  // Fixed colours, not theme tokens: the tiles stay light in dark mode, so a
  // bubble painted with `--foreground` would inverse itself against a
  // background that never moved. #1f2937 on white is 14.7:1, and the white
  // ring keeps it off any darker tile feature underneath.
  link.className =
    'rounded-full bg-[#1f2937] px-2 py-1 text-xs font-semibold whitespace-nowrap text-white ring-2 ring-white'
  link.setAttribute('aria-label', `${facility.name}, ${facility.priceLabel}, ${facility.address}`)
  return link
}
