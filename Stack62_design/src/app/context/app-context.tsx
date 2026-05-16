import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import {
  clearStoredWorkspaceId,
  apiRequest,
  clearStoredSession,
  getStoredOrganizationId,
  getStoredToken,
  getStoredWorkspaceId,
  setStoredOrganizationId,
  setStoredToken,
  setStoredWorkspaceId,
} from '../lib/api';

export interface AuthUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  status: string;
  /** File id of the user's uploaded avatar; null when not set. */
  avatarFileId?: string | null;
  /** When the user clicked the verify-email link. Null = unverified. */
  emailVerifiedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  status: string;
  ownerUserId: string;
  createdAt: string;
  updatedAt: string;
}

export interface Workspace {
  id: string;
  organizationId: string;
  name: string;
  slug: string;
  description?: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
}

interface AuthResponse {
  accessToken: string;
  user: AuthUser;
}

interface AppContextValue {
  isBootstrapping: boolean;
  isAuthenticated: boolean;
  token: string | null;
  user: AuthUser | null;
  organizations: Organization[];
  workspaces: Workspace[];
  currentOrganization: Organization | null;
  currentWorkspace: Workspace | null;
  needsOrganization: boolean;
  needsWorkspace: boolean;
  login: (input: { email: string; password: string }) => Promise<void>;
  register: (input: {
    email: string;
    password: string;
    firstName: string;
    lastName: string;
    accountType?: 'individual' | 'organization';
    organizationName?: string;
    organizationRole?: string;
    organizationTeamSize?: number;
    inviteToken?: string;
  }) => Promise<void>;
  applyExternalSession: (input: {
    accessToken: string;
  }) => Promise<void>;
  logout: () => void;
  refreshContext: () => Promise<void>;
  createOrganization: (input: {
    name: string;
    description?: string;
  }) => Promise<Organization>;
  createWorkspace: (input: {
    name: string;
    description?: string;
  }) => Promise<Workspace>;
  setActiveOrganizationId: (organizationId: string) => void;
  setActiveWorkspaceId: (workspaceId: string) => void;
  clearActiveWorkspace: () => void;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const [token, setTokenState] = useState<string | null>(getStoredToken());
  const [user, setUser] = useState<AuthUser | null>(null);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [activeOrganizationId, setActiveOrganizationIdState] = useState<
    string | null
  >(getStoredOrganizationId());
  const [activeWorkspaceId, setActiveWorkspaceIdState] = useState<string | null>(
    getStoredWorkspaceId(),
  );

  const logout = useCallback(() => {
    clearStoredSession();
    setTokenState(null);
    setUser(null);
    setOrganizations([]);
    setWorkspaces([]);
    setActiveOrganizationIdState(null);
    setActiveWorkspaceIdState(null);
    setIsBootstrapping(false);
  }, []);

  const setActiveOrganizationId = useCallback((organizationId: string) => {
    setStoredOrganizationId(organizationId);
    setActiveOrganizationIdState(organizationId);
    clearStoredWorkspaceId();
    setActiveWorkspaceIdState(null);
  }, []);

  const setActiveWorkspaceId = useCallback((workspaceId: string) => {
    setStoredWorkspaceId(workspaceId);
    setActiveWorkspaceIdState(workspaceId);
  }, []);

  const clearActiveWorkspace = useCallback(() => {
    clearStoredWorkspaceId();
    setActiveWorkspaceIdState(null);
  }, []);

  const loadOrganizations = useCallback(
    async (authToken: string) => {
      const [nextUser, nextOrganizations] = await Promise.all([
        apiRequest<AuthUser>('/users/me', { token: authToken }),
        apiRequest<Organization[]>('/organizations', { token: authToken }),
      ]);

      setUser(nextUser);
      setOrganizations(nextOrganizations);

      const storedOrganizationId = getStoredOrganizationId();
      const selectedOrganization =
        nextOrganizations.find((item) => item.id === storedOrganizationId) ||
        nextOrganizations[0] ||
        null;

      if (selectedOrganization) {
        setStoredOrganizationId(selectedOrganization.id);
        setActiveOrganizationIdState(selectedOrganization.id);
      } else {
        setActiveOrganizationIdState(null);
      }
    },
    [],
  );

  const loadWorkspaces = useCallback(
    async (organizationId: string, authToken: string) => {
      const nextWorkspaces = await apiRequest<Workspace[]>('/workspaces', {
        token: authToken,
        query: { organizationId },
      });

      setWorkspaces(nextWorkspaces);

      const storedWorkspaceId = getStoredWorkspaceId();
      const selectedWorkspace =
        nextWorkspaces.find((item) => item.id === storedWorkspaceId) ||
        nextWorkspaces[0] ||
        null;

      if (selectedWorkspace) {
        setStoredWorkspaceId(selectedWorkspace.id);
        setActiveWorkspaceIdState(selectedWorkspace.id);
      } else {
        setActiveWorkspaceIdState(null);
      }
    },
    [],
  );

  const refreshContext = useCallback(async () => {
    if (!token) {
      setIsBootstrapping(false);
      return;
    }

    try {
      setIsBootstrapping(true);
      await loadOrganizations(token);
    } catch (error) {
      if (
        error &&
        typeof error === 'object' &&
        'status' in error &&
        error.status === 401
      ) {
        logout();
        return;
      }
      throw error;
    } finally {
      setIsBootstrapping(false);
    }
  }, [loadOrganizations, logout, token]);

  useEffect(() => {
    void refreshContext();
  }, [refreshContext]);

  useEffect(() => {
    if (!token || !activeOrganizationId) {
      setWorkspaces([]);
      setActiveWorkspaceIdState(null);
      return;
    }

    void loadWorkspaces(activeOrganizationId, token).catch((error) => {
      if (
        error &&
        typeof error === 'object' &&
        'status' in error &&
        error.status === 401
      ) {
        logout();
      }
    });
  }, [activeOrganizationId, loadWorkspaces, logout, token]);

  const finishAuth = useCallback(
    async (response: AuthResponse) => {
      setStoredToken(response.accessToken);
      setTokenState(response.accessToken);
      setUser(response.user);
      setIsBootstrapping(true);
      await loadOrganizations(response.accessToken);
      setIsBootstrapping(false);
    },
    [loadOrganizations],
  );

  const login = useCallback(
    async (input: { email: string; password: string }) => {
      const response = await apiRequest<AuthResponse>('/auth/login', {
        method: 'POST',
        body: input,
        token: null,
      });
      await finishAuth(response);
    },
    [finishAuth],
  );

  const register = useCallback(
    async (input: {
      email: string;
      password: string;
      firstName: string;
      lastName: string;
      accountType?: 'individual' | 'organization';
      organizationName?: string;
      organizationRole?: string;
      organizationTeamSize?: number;
      inviteToken?: string;
    }) => {
      const response = await apiRequest<AuthResponse>('/auth/register', {
        method: 'POST',
        body: input,
        token: null,
      });
      await finishAuth(response);
    },
    [finishAuth],
  );

  /**
   * Drop in a JWT obtained outside the password flow (Google OAuth
   * callback hands us one via the URL fragment). We re-use the same
   * post-auth bootstrap so the user lands in the same place.
   */
  const applyExternalSession = useCallback(
    async (input: { accessToken: string }) => {
      const me = await apiRequest<AuthUser>('/users/me', {
        token: input.accessToken,
      }).catch(() => null);
      const response: AuthResponse = {
        accessToken: input.accessToken,
        user: me ?? ({} as AuthUser),
      };
      await finishAuth(response);
    },
    [finishAuth],
  );

  const createOrganization = useCallback(
    async (input: { name: string; description?: string }) => {
      if (!token) {
        throw new Error('You must be signed in to create an organization.');
      }

      const organization = await apiRequest<Organization>('/organizations', {
        method: 'POST',
        body: input,
        token,
      });

      await loadOrganizations(token);
      setActiveOrganizationId(organization.id);
      return organization;
    },
    [loadOrganizations, setActiveOrganizationId, token],
  );

  const createWorkspace = useCallback(
    async (input: { name: string; description?: string }) => {
      if (!token || !activeOrganizationId) {
        throw new Error('Select an organization before creating a workspace.');
      }

      const workspace = await apiRequest<Workspace>('/workspaces', {
        method: 'POST',
        token,
        body: {
          organizationId: activeOrganizationId,
          name: input.name,
          description: input.description,
        },
      });

      await loadWorkspaces(activeOrganizationId, token);
      setActiveWorkspaceId(workspace.id);
      return workspace;
    },
    [activeOrganizationId, loadWorkspaces, setActiveWorkspaceId, token],
  );

  const currentOrganization =
    organizations.find((item) => item.id === activeOrganizationId) || null;
  const currentWorkspace =
    workspaces.find((item) => item.id === activeWorkspaceId) || null;

  const value = useMemo<AppContextValue>(
    () => ({
      isBootstrapping,
      isAuthenticated: Boolean(token),
      token,
      user,
      organizations,
      workspaces,
      currentOrganization,
      currentWorkspace,
      needsOrganization: Boolean(token) && organizations.length === 0,
      needsWorkspace:
        Boolean(token) && organizations.length > 0 && workspaces.length === 0,
      login,
      register,
      applyExternalSession,
      logout,
      refreshContext,
      createOrganization,
      createWorkspace,
      setActiveOrganizationId,
      setActiveWorkspaceId,
      clearActiveWorkspace,
    }),
    [
      createOrganization,
      createWorkspace,
      clearActiveWorkspace,
      currentOrganization,
      currentWorkspace,
      isBootstrapping,
      login,
      logout,
      organizations,
      refreshContext,
      register,
      applyExternalSession,
      setActiveOrganizationId,
      setActiveWorkspaceId,
      token,
      user,
      workspaces,
    ],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useAppContext() {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useAppContext must be used within an AppProvider.');
  }

  return context;
}
