import { useEffect, useRef, useState } from 'react';
import type { LatLng } from '@/lib/geo';

// Leaflet is loaded from a CDN on first use, so it adds nothing to the main bundle.
const LEAFLET_VERSION = '1.9.4';
const LEAFLET_JS = `https://unpkg.com/leaflet@${LEAFLET_VERSION}/dist/leaflet.js`;
const LEAFLET_CSS = `https://unpkg.com/leaflet@${LEAFLET_VERSION}/dist/leaflet.css`;

/* eslint-disable @typescript-eslint/no-explicit-any */
type LeafletGlobal = any;
let leafletPromise: Promise<LeafletGlobal> | null = null;

function loadLeaflet(): Promise<LeafletGlobal> {
  const w = window as unknown as { L?: LeafletGlobal };
  if (w.L) return Promise.resolve(w.L);
  if (!leafletPromise) {
    leafletPromise = new Promise((resolve, reject) => {
      if (!document.querySelector(`link[href="${LEAFLET_CSS}"]`)) {
        const css = document.createElement('link');
        css.rel = 'stylesheet';
        css.href = LEAFLET_CSS;
        document.head.appendChild(css);
      }
      const script = document.createElement('script');
      script.src = LEAFLET_JS;
      script.async = true;
      script.onload = () => resolve((window as unknown as { L: LeafletGlobal }).L);
      script.onerror = () => { leafletPromise = null; reject(new Error('Map could not load.')); };
      document.head.appendChild(script);
    });
  }
  return leafletPromise;
}

type Props = {
  /** Normal place of stay from the archive. */
  home?: (LatLng & { address?: string | undefined }) | undefined;
  /** Positions oldest → newest; the last one is "now". */
  track: LatLng[];
  className?: string;
};

/** Map with the patient's home, current position and the path between updates. */
export function LiveMap({ home, track, className }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<any>(null);
  const layer = useRef<any>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadLeaflet()
      .then((L) => {
        if (cancelled || !box.current || map.current) return;
        map.current = L.map(box.current, { zoomControl: true, attributionControl: true });
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 19,
          attribution: '© OpenStreetMap',
        }).addTo(map.current);
        layer.current = L.layerGroup().addTo(map.current);
        draw(L);
      })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const L = (window as unknown as { L?: LeafletGlobal }).L;
    if (L && map.current) draw(L);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [home?.lat, home?.lng, JSON.stringify(track)]);

  useEffect(() => () => { map.current?.remove(); map.current = null; }, []);

  function draw(L: LeafletGlobal) {
    if (!layer.current) return;
    layer.current.clearLayers();
    const points: [number, number][] = [];
    if (home) {
      L.circleMarker([home.lat, home.lng], { radius: 9, color: '#1d4ed8', fillColor: '#3b82f6', fillOpacity: 0.9, weight: 2 })
        .bindTooltip(`Home${home.address ? `: ${home.address}` : ''}`)
        .addTo(layer.current);
      points.push([home.lat, home.lng]);
    }
    if (track.length > 1) {
      L.polyline(track.map((p) => [p.lat, p.lng]), { color: '#dc2626', weight: 3, opacity: 0.7, dashArray: '4 6' }).addTo(layer.current);
    }
    const now = track[track.length - 1];
    if (now) {
      L.circleMarker([now.lat, now.lng], { radius: 11, color: '#991b1b', fillColor: '#ef4444', fillOpacity: 0.95, weight: 3 })
        .bindTooltip('Patient now', { permanent: true, direction: 'top', offset: [0, -10] })
        .addTo(layer.current);
      points.push([now.lat, now.lng]);
    }
    if (points.length >= 2) map.current.fitBounds(points, { padding: [36, 36], maxZoom: 16 });
    else if (points[0]) map.current.setView(points[0], 15);
  }

  if (failed) {
    const now = track[track.length - 1];
    return (
      <p className="rounded-md border border-border p-3 text-xs text-muted-foreground">
        The map could not load.{' '}
        {now && <a className="text-primary underline" href={`https://www.google.com/maps?q=${now.lat},${now.lng}`} target="_blank" rel="noreferrer">Open the location in Google Maps</a>}
      </p>
    );
  }
  return <div ref={box} className={className ?? 'h-64 w-full overflow-hidden rounded-md border border-border'} role="img" aria-label="Map of the patient's home and current location" />;
}
