const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

export type AppUser = { id: string; name: string; email: string; role: 'student' | 'driver' | 'admin' };
export type ApiItem = {
  id: string; name: string; title: string; description: string; category: string;
  place: string; location: string; status: 'Lost' | 'Found' | 'Claimed' | 'Resolved';
  match: number; image: string; imageUrl?: string; date: string;
};
export type ApiNotification = { _id: string; title: string; message: string; type: 'match'|'bus'|'alert'|'system'; read: boolean; createdAt: string };
export type ShuttleData = {
  _id: string; code: string; routeName: string; origin: string; destination: string; stops: string[];
  latitude?: number; longitude?: number; speedKmph?: number; lastGpsAt?: string; active: boolean;
};

function authHeaders(): HeadersInit {
  const token = localStorage.getItem('campusconnect_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}
async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers || {});
  Object.entries(authHeaders()).forEach(([k,v]) => headers.set(k, String(v)));
  if (!(init.body instanceof FormData) && init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const response = await fetch(`${API_BASE}${path}`, { ...init, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || `Request failed (${response.status})`);
  return data as T;
}
export async function getItems() { return request<{items: ApiItem[]}>('/items'); }
export async function createItem(form: FormData) { return request<{item: ApiItem}>('/items', { method: 'POST', body: form }); }
export async function login(email: string, password: string) {
  const data = await request<{token:string; user:AppUser}>('/auth/login', { method:'POST', body:JSON.stringify({email,password}) });
  localStorage.setItem('campusconnect_token', data.token); return data.user;
}
export async function register(name: string, email: string, password: string, role: 'student'|'driver') {
  const data = await request<{token:string; user:AppUser}>('/auth/register', { method:'POST', body:JSON.stringify({name,email,password,role}) });
  localStorage.setItem('campusconnect_token', data.token); return data.user;
}
export async function getMe() { return request<{user:AppUser}>('/auth/me'); }
export async function getNotifications() { return request<{notifications:ApiNotification[]}>('/notifications'); }
export async function getShuttles() { return request<{shuttles:ShuttleData[]}>('/shuttles'); }
export async function getHealth() { return request<{status:string}>('/health'); }
export function logout() { localStorage.removeItem('campusconnect_token'); }
export const socketUrl = (import.meta.env.VITE_SOCKET_URL || 'http://localhost:5000');

export async function updateShuttleLocation(code: string, coords: {latitude:number;longitude:number;heading?:number;speedKmph?:number}) {
  return request<{shuttle:ShuttleData}>(`/shuttles/${code}/location`, { method:'POST', body:JSON.stringify(coords) });
}

export async function requestItemClaim(id: string | number) {
  return request<{message:string}>(`/items/${id}/claim`, { method:'POST' });
}
export async function markAllNotificationsRead() {
  return request<{message:string}>('/notifications/read-all', { method:'PATCH' });
}

export type MatchResult = ApiItem & { score: number; scoreBreakdown: { visual: number|null; text: number; location: number } };
export async function getItemMatches(id: string|number) { return request<{matches:MatchResult[]; aiMode:string}>(`/items/${id}/matches`); }
