// Browser transport for the GitHub Pages build: runs the API in this tab instead of on a server.
// The build copies this over public/transport.js.
import { handle } from './engine/routes.js';
import { persist, STORAGE_KEY } from './engine/db.js';

export const MODE = 'browser';
const TOKEN_KEY = 'fragline.sid';

const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* private mode */ } },
};

export async function request(method, path, body) {
  const [p, qs] = path.split('?');
  const result = handle({
    method,
    path: p,
    body: body ? JSON.parse(JSON.stringify(body)) : {},
    query: Object.fromEntries(new URLSearchParams(qs || '')),
    token: store.get(TOKEN_KEY) || undefined,
  });
  if (result.token !== undefined) store.set(TOKEN_KEY, result.token);
  if (method !== 'GET') persist();
  return { status: result.status, data: result.data };
}

export function resetData() {
  store.set(STORAGE_KEY, null);
  store.set(TOKEN_KEY, null);
  location.hash = '#/';
  location.reload();
}
