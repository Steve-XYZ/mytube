import * as http from 'http';
import type { AddressInfo } from 'net';

export interface TestServer {
  baseUrl: string;
  close(): Promise<void>;
}

const PAGES: Record<string, string> = {
  '/': `<!doctype html>
<html>
  <head><title>E2E Page A</title></head>
  <body>
    <h1 id="heading">Page A</h1>
    <a id="to-b" href="/b">Go to page B</a>
  </body>
</html>`,
  '/b': `<!doctype html>
<html>
  <head><title>E2E Page B</title></head>
  <body>
    <h1 id="heading">Page B</h1>
    <a id="to-a" href="/">Back to page A</a>
  </body>
</html>`,
};

/** Local static server so navigation tests never depend on the live network. */
export async function startTestServer(): Promise<TestServer> {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    const body = PAGES[url.pathname];
    if (!body) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(body);
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
}
