import './src/lib/env.js';
import { createApp } from './src/app.js';

const port = Number(process.env.PORT) || 3000;
const host = process.env.HOST || '127.0.0.1';

const app = createApp();
const server = app.listen(port, host, () => {
  console.log(`Portfolio running at http://${host}:${port}`);
  console.log(`Admin at        http://${host}:${port}/admin`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(() => {
      app.locals.close?.();
      process.exit(0);
    });
  });
}
