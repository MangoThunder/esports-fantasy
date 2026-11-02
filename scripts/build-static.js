// Builds the GitHub Pages version into dist/: the normal frontend, plus the API and
// database running in the browser instead of on a server.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'dist');
const copy = (from, to) => {
  fs.mkdirSync(path.dirname(path.join(out, to)), { recursive: true });
  fs.cpSync(path.join(root, from), path.join(out, to), { recursive: true });
};

fs.rmSync(out, { recursive: true, force: true });
copy('public', '.');

// Shared server code, unchanged.
for (const f of ['routes.js', 'scoring.js', 'seed.js', 'sim.js', 'schema.js']) copy(`server/${f}`, `engine/${f}`);
// Browser stand-ins for the Node-only pieces.
copy('web/db.js', 'engine/db.js');
copy('web/crypto.js', 'engine/crypto.js');
copy('web/transport.js', 'transport.js');
// SQLite compiled to WebAssembly.
copy('node_modules/sql.js/dist/sql-wasm.js', 'vendor/sql-wasm.js');
copy('node_modules/sql.js/dist/sql-wasm.wasm', 'vendor/sql-wasm.wasm');
// Stop GitHub Pages from running Jekyll over the files.
fs.writeFileSync(path.join(out, '.nojekyll'), '');

console.log('Built static site in dist/');
