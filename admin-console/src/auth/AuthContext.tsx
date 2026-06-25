import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { api, clearToken, getToken, setToken } from '../lib/api';
import type { AuthenticatedStaff } from '../lib/types';

interface AuthState {
  staff: AuthenticatedStaff | null;
  loading: boolean;
  signIn: (accessToken: string, staff: AuthenticatedStaff) => void;
  signOut: () => void;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [staff, setStaff] = useState<AuthenticatedStaff | null>(null);
  const [loading, setLoading] = useState(true);

  // Re-hydrate the session on load: if a token is stored, ask the backend who
  // we are. An expired/invalid token clears itself via the api 401 handler.
  useEffect(() => {
    let active = true;
    async function hydrate() {
      if (!getToken()) {
        setLoading(false);
        return;
      }
      try {
        const me = await api<AuthenticatedStaff>('/auth/me', { method: 'POST' });
        if (active) setStaff(me);
      } catch {
        clearToken();
      } finally {
        if (active) setLoading(false);
      }
    }
    void hydrate();
    return () => {
      active = false;
    };
  }, []);

  const signIn = useCallback(
    (accessToken: string, nextStaff: AuthenticatedStaff) => {
      setToken(accessToken);
      setStaff(nextStaff);
    },
    [],
  );

  const signOut = useCallback(() => {
    clearToken();
    setStaff(null);
  }, []);

  const value = useMemo(
    () => ({ staff, loading, signIn, signOut }),
    [staff, loading, signIn, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
