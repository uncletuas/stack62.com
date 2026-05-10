const API_BASE_URL = (
  import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000/v1'
).replace(/\/$/, '');

const TOKEN_STORAGE_KEY = 'stack62.accessToken';
const ORGANIZATION_STORAGE_KEY = 'stack62.organizationId';
const WORKSPACE_STORAGE_KEY = 'stack62.workspaceId';

export class ApiError extends Error {
  status: number;
  data: unknown;

  constructor(message: string, status: number, data: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
  }
}

function extractErrorMessage(data: unknown, fallback: string): string {
  if (typeof data === 'string' && data.trim()) {
    return data;
  }

  if (typeof data !== 'object' || data === null) {
    return fallback;
  }

  const record = data as Record<string, unknown>;
  const message = record.message;

  if (Array.isArray(message)) {
    const messages = message
      .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      .join(' ');
    if (messages) return messages;
  }

  if (typeof message === 'string' && message.trim()) {
    return message;
  }

  if (typeof record.error === 'string' && record.error.trim()) {
    return record.error;
  }

  return fallback;
}

export function getApiBaseUrl() {
  return API_BASE_URL;
}

export function getStoredToken() {
  return localStorage.getItem(TOKEN_STORAGE_KEY);
}

export function setStoredToken(token: string) {
  localStorage.setItem(TOKEN_STORAGE_KEY, token);
}

export function clearStoredToken() {
  localStorage.removeItem(TOKEN_STORAGE_KEY);
}

export function getStoredOrganizationId() {
  return localStorage.getItem(ORGANIZATION_STORAGE_KEY);
}

export function setStoredOrganizationId(organizationId: string) {
  localStorage.setItem(ORGANIZATION_STORAGE_KEY, organizationId);
}

export function clearStoredOrganizationId() {
  localStorage.removeItem(ORGANIZATION_STORAGE_KEY);
}

export function getStoredWorkspaceId() {
  return localStorage.getItem(WORKSPACE_STORAGE_KEY);
}

export function setStoredWorkspaceId(workspaceId: string) {
  localStorage.setItem(WORKSPACE_STORAGE_KEY, workspaceId);
}

export function clearStoredWorkspaceId() {
  localStorage.removeItem(WORKSPACE_STORAGE_KEY);
}

export function clearStoredSession() {
  clearStoredToken();
  clearStoredOrganizationId();
  clearStoredWorkspaceId();
}

function buildUrl(
  path: string,
  query?: Record<string, string | number | boolean | null | undefined>,
) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const url = new URL(`${API_BASE_URL}${normalizedPath}`);

  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  }

  return url.toString();
}

async function parseResponse(response: Response) {
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    return response.json();
  }

  const text = await response.text();
  return text || null;
}

export async function apiRequest<T = unknown>(
  path: string,
  options?: {
    method?: string;
    body?: unknown;
    headers?: HeadersInit;
    query?: Record<string, string | number | boolean | null | undefined>;
    token?: string | null;
    signal?: AbortSignal;
  },
): Promise<T> {
  const token = options?.token ?? getStoredToken();
  const headers = new Headers(options?.headers);
  const body = options?.body;

  if (!(body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }

  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  let response: Response;
  try {
    response = await fetch(buildUrl(path, options?.query), {
      method: options?.method || 'GET',
      headers,
      body:
        body === undefined
          ? undefined
          : body instanceof FormData
            ? body
            : JSON.stringify(body),
      signal: options?.signal,
    });
  } catch (error) {
    const message =
      error instanceof TypeError
        ? `Network connection failed. Check that the Stack62 API is running at ${API_BASE_URL}.`
        : error instanceof Error
          ? error.message
          : 'Network connection failed.';
    throw new ApiError(message, 0, { cause: message });
  }

  const data = await parseResponse(response);
  if (!response.ok) {
    const message = extractErrorMessage(data, `HTTP ${response.status} ${response.statusText}`.trim());
    throw new ApiError(message, response.status, data);
  }

  return data as T;
}
