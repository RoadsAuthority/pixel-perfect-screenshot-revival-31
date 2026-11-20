import { useCallback, useEffect, useRef, useState } from 'react';
import { callArchive } from '@/lib/archive';
import { simulatedPosition, type Coords, type Simulation } from '@/lib/geo';

export type LiveShare = { alertId: string; updateKey: string; url: string; simulation?: Simulation | undefined };

const SEND_EVERY_MS = 10000;
const STOP_AFTER_MS = 60 * 60 * 1000;

/**
 * After an emergency alert, keep sending this phone's position to the clinic every
 * 10 seconds until the person stops it (or after one hour). In demo simulation mode
 * the position moves along a simulated path instead of using GPS.
 */
export function useLiveShare(share: LiveShare | null) {
  const [lastSent, setLastSent] = useState<Date | null>(null);
  const [error, setError] = useState('');
  const latest = useRef<Coords | null>(null);
  const step = useRef(1);

  useEffect(() => {
    setLastSent(null); setError(''); latest.current = null; step.current = 1;
    if (!share) return;
    let watchId: number | null = null;
    if (!share.simulation && navigator.geolocation) {
      watchId = navigator.geolocation.watchPosition(
        (pos) => { latest.current = { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }; },
        () => setError('Location is not available. The clinic still has your first position.'),
        { enableHighAccuracy: true, maximumAge: 5000 },
      );
    }
    const started = Date.now();
    const send = async () => {
      if (Date.now() - started > STOP_AFTER_MS) return;
      const pos = share.simulation ? simulatedPosition(share.simulation, step.current++) : latest.current;
      if (!pos) return;
      try {
        await callArchive(share.url, {
          action: 'alert_location', user_id: 'PUBLIC', alert_id: share.alertId, update_key: share.updateKey,
          lat: pos.lat, lng: pos.lng, accuracy: pos.accuracy, simulated: !!share.simulation,
        });
        setLastSent(new Date()); setError('');
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not send your location.');
      }
    };
    void send();
    const timer = window.setInterval(() => void send(), SEND_EVERY_MS);
    return () => {
      window.clearInterval(timer);
      if (watchId !== null) navigator.geolocation.clearWatch(watchId);
    };
  }, [share]);

  const reset = useCallback(() => { setLastSent(null); setError(''); }, []);
  return { lastSent, error, reset };
}
