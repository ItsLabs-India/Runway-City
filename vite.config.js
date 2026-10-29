import { defineConfig } from 'vite';
import worker from './worker/index.js';

// In development (and in `vite preview`) the same proxy code that runs on Cloudflare answers
// /api/* inside Node, so live weather and traffic work without deploying anything.
function apiPlugin() {
  const handler = async (req, res, next) => {
    if (!req.url?.startsWith('/api/')) return next();
    const response = await worker.fetch(new Request(`http://localhost${req.url}`, { method: req.method }));
    res.statusCode = response.status;
    response.headers.forEach((value, key) => res.setHeader(key, value));
    res.end(Buffer.from(await response.arrayBuffer()));
  };
  return {
    name: 'runway-api',
    configureServer(server) {
      server.middlewares.use(handler); // no return: a returned function would be run as a post hook
    },
    configurePreviewServer(server) {
      server.middlewares.use(handler);
    },
  };
}

export default defineConfig({
  base: './', // relative paths so the build works on any static host
  build: { target: 'es2022' }, // allows top-level await in main.js
  plugins: [apiPlugin()],
});
