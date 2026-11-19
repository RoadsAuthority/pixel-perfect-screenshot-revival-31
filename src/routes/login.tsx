import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { ArrowRight, HeartPulse, LockKeyhole } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/use-auth';
import { DEFAULT_API_URL } from '@/lib/api-config';

export const Route = createFileRoute('/login')({
  head: () => ({
    meta: [
      { title: 'Sign In — Ask the Archive' },
      { name: 'description', content: 'Sign in to the Hopewell Community Clinic archive.' },
    ],
  }),
  component: LoginPage,
});

function LoginPage() {
  const { login, loading, session } = useAuth();
  const navigate = useNavigate();

  const [userId, setUserId] = useState('');
  const [pin, setPin] = useState('');
  const [apiUrl, setApiUrl] = useState(DEFAULT_API_URL);
  const [error, setError] = useState('');

  useEffect(() => {
    if (session) void navigate({ to: '/', replace: true });
  }, [session, navigate]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    try {
      await login(apiUrl, userId.trim().toUpperCase(), pin);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed.');
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="border-b border-border bg-card">
        <div className="app-shell flex h-[88px] items-center gap-3">
          <div className="brand-mark"><HeartPulse size={25} /></div>
          <div>
            <div className="brand-title text-xl font-bold">Ask the Archive<span className="text-primary">.</span></div>
            <div className="brand-subtitle mt-1 text-xs text-muted-foreground">HOPEWELL COMMUNITY CLINIC</div>
          </div>
        </div>
      </header>

      <main className="app-shell flex flex-1 items-center justify-center py-16">
        <div className="w-full max-w-sm">
          <div className="mb-8 text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-secondary">
              <LockKeyhole size={26} className="text-primary" />
            </div>
            <h1 className="text-2xl font-semibold">Sign in</h1>
            <p className="mt-2 text-sm text-muted-foreground">Use your clinic ID and PIN to access the archive.</p>
          </div>

          <form onSubmit={(e) => { void handleSubmit(e); }} className="space-y-4">
            <div>
              <label htmlFor="user-id" className="mb-1.5 block text-sm font-medium">Clinic ID</label>
              <input id="user-id" type="text" autoComplete="username" placeholder="e.g. PAT-001 or NUR-001" value={userId} onChange={(e) => setUserId(e.target.value)} className="h-12 w-full rounded-md border border-input bg-card px-3 text-sm" required />
            </div>
            <div>
              <label htmlFor="pin" className="mb-1.5 block text-sm font-medium">PIN</label>
              <input id="pin" type="password" inputMode="numeric" maxLength={4} autoComplete="current-password" placeholder="4-digit PIN" value={pin} onChange={(e) => setPin(e.target.value)} className="h-12 w-full rounded-md border border-input bg-card px-3 text-sm" required />
            </div>
            {!DEFAULT_API_URL && (
              <div>
                <label htmlFor="api-url" className="mb-1.5 block text-sm font-medium">Clinic API URL</label>
                <input id="api-url" type="url" placeholder="https://your-service.onrender.com/archive" value={apiUrl} onChange={(e) => setApiUrl(e.target.value)} className="h-12 w-full rounded-md border border-input bg-card px-3 text-sm" required />
              </div>
            )}
            {error && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">{error}</p>}
            <Button type="submit" variant="clinic" size="touch" className="w-full" disabled={loading || !userId.trim() || !pin.trim() || !apiUrl.trim()}>
              {loading ? 'Verifying…' : 'Sign in'}
              <ArrowRight />
            </Button>
          </form>
        </div>
      </main>
    </div>
  );
}
