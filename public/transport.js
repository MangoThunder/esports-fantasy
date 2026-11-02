// Server transport: talks to the Node API over HTTP.
// The GitHub Pages build replaces this file with web/transport.js.
export const MODE = 'server';

export async function request(method, path, body) {
  const res = await fetch('api' + path, {
    cache: 'no-store',
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

export function resetData() {}
