/**
 * AuthProvider + useAuth hook.
 *
 * The session lives in memory only (a refresh signs the user out), per the
 * project rule that no patient information or credentials are persisted in
 * the browser. The server is the authority for every access decision.
 */

import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { sessionFromVerify, type AuthSession } from '@/lib/auth';
import { callArchive } from '@/lib/archive';

type AuthContextValue = {
  /** The current session, or null if not signed in. */
  session: AuthSession | null;
  /** True while a sign-in request is in flight. */
  loading: boolean;
  /** Sign in against the clinic API. Returns the session or throws a user-visible error. */
  login: (apiUrl: string, userId: string, pin: string) => Promise<AuthSession>;
  /** Clear the in-memory session. */
  logout: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [loading, setLoading] = useState(false);

  const login = useCallback(async (apiUrl: string, userId: string, pin: string): Promise<AuthSession> => {
    setLoading(true);
    try {
      const data = await callArchive(apiUrl, { action: 'verify', user_id: userId, pin, channel: 'web' });
      const newSession = sessionFromVerify(data, userId, apiUrl.trim());
      setSession(newSession);
      return newSession;
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(() => setSession(null), []);

  return <AuthContext.Provider value={{ session, loading, login, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>.');
  return ctx;
}
