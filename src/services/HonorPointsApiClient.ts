/**
 * Client for Honor Points API (honor-points-service).
 * All honor point changes go through this centralized API to prevent race conditions.
 */

const baseUrl = (process.env.HONOR_POINTS_API_URL ?? '').replace(/\/$/, '');
const apiKey = process.env.HONOR_POINTS_API_KEY ?? '';

export function isHonorPointsApiEnabled(): boolean {
  return Boolean(baseUrl && apiKey);
}

async function request<T>(
  method: string,
  path: string,
  body?: Record<string, unknown>,
): Promise<{ success: boolean; honorPoints?: number; error?: string; currentPoints?: number }> {
  const url = `${baseUrl}${path}`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-API-Key': apiKey,
  };
  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = (await res.json().catch(() => ({}))) as T & {
    success?: boolean;
    honorPoints?: number;
    error?: string;
    currentPoints?: number;
  };
  if (!res.ok) {
    return { success: false, error: data.error ?? res.statusText, currentPoints: data.currentPoints };
  }
  return { success: data.success ?? true, honorPoints: data.honorPoints, error: data.error };
}

export async function getBalance(userId: string): Promise<number> {
  const r = await request('GET', `/api/users/${userId}/points`);
  return r.success && typeof r.honorPoints === 'number' ? r.honorPoints : 0;
}

export async function add(
  userId: string,
  amount: number,
  username?: string,
): Promise<{ success: boolean; error?: string; newBalance?: number }> {
  const r = await request<{ honorPoints?: number }>('POST', `/api/users/${userId}/points/add`, {
    amount,
    username,
  });
  return { success: r.success, error: r.error, newBalance: r.honorPoints };
}

export async function deduct(
  userId: string,
  amount: number,
): Promise<{ success: boolean; error?: string; newBalance?: number }> {
  const r = await request<{ honorPoints?: number }>('POST', `/api/users/${userId}/points/deduct`, {
    amount,
  });
  return { success: r.success, error: r.error, newBalance: r.honorPoints };
}
