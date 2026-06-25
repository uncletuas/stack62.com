// API client for the admin console. Talks to the SAME backend as the customer
// app but only to the /v1/admin/* namespace, with its OWN token storage key so
// a customer session can never leak in. In production VITE_ADMIN_API_BASE_URL is
// baked in (e.g. https://assembly.loopital.com/v1/admin); in dev the Vite proxy
// forwards /v1 to the backend, so the relative default works.
const ADMIN_API_BASE_URL = (
  import.meta.env.VITE_ADMIN_API_BASE_URL || '/v1/admin'
).replace(/\/$/, '');

const TOKEN_KEY = 'assembly.adminToken';

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

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}
export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

function extractMessage(data: unknown, fallback: string): string {
  if (typeof data === 'string' && data.trim()) return data;
  if (typeof data !== 'object' || data === null) return fallback;
  const record = data as Record<string, unknown>;
  const message = record.message;
  if (Array.isArray(message)) {
    const joined = message.filter((m) => typeof m === 'string').join(' ');
    if (joined) return joined;
  }
  if (typeof message === 'string' && message.trim()) return message;
  if (typeof record.error === 'string' && record.error.trim())
    return record.error;
  return fallback;
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  query?: Record<string, string | number | undefined>;
  auth?: boolean;
}

export async function api<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const { method = 'GET', body, query, auth = true } = options;
  const url = new URL(`${ADMIN_API_BASE_URL}${path}`, window.location.origin);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== '') {
        url.searchParams.set(key, String(value));
      }
    }
  }

  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (auth) {
    const token = getToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(url.toString(), {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (response.status === 401 && auth) {
    clearToken();
  }

  const contentType = response.headers.get('content-type') ?? '';
  const payload = contentType.includes('application/json')
    ? await response.json().catch(() => null)
    : await response.text();

  if (!response.ok) {
    throw new ApiError(
      extractMessage(payload, `Request failed (${response.status})`),
      response.status,
      payload,
    );
  }
  return payload as T;
}
