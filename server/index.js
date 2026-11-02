// Node server: serves public/ and exposes server/routes.js at /api.
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { handle } from './routes.js';

const app = express();
app.use(express.json());
app.use(express.static(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public')));

const cookie = (req, name) => {
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return undefined;
};

app.use('/api', (req, res) => {
  const result = handle({
    method: req.method,
    path: req.path,
    body: req.body,
    query: req.query,
    token: cookie(req, 'sid'),
  });
  if (result.token) {
    res.setHeader('Set-Cookie', `sid=${result.token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${60 * 60 * 24 * 30}`);
  } else if (result.token === null) {
    res.setHeader('Set-Cookie', 'sid=; Path=/; Max-Age=0');
  }
  res.setHeader('Cache-Control', 'no-store');
  res.status(result.status).json(result.data);
});

const PORT = Number(process.env.PORT) || 3000;
app.listen(PORT, () => console.log(`Esports fantasy running at http://localhost:${PORT}`));
