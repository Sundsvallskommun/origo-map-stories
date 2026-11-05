// Minimal stand-in for a reverse proxy (e.g. nginx) that publishes the content
// server under a path prefix: <prefix>/... is forwarded to the target with the prefix stripped; any
// other path answers 404 and is logged as "OUTSIDE <path>" so the tests can
// detect requests that missed the prefix.
//
//   node base-path-proxy.js <listenPort> <targetBaseUrl> <prefix>
const http = require('http');

const [port, target, prefix] = process.argv.slice(2);
const targetUrl = new URL(target);

http.createServer((req, res) => {
  if (req.url !== prefix && !req.url.startsWith(`${prefix}/`) && !req.url.startsWith(`${prefix}?`)) {
    console.log(`OUTSIDE ${req.url}`);
    res.writeHead(404).end();
    return;
  }
  const path = req.url.slice(prefix.length) || '/';
  const upstream = http.request({
    hostname: targetUrl.hostname,
    port: targetUrl.port,
    path: path.startsWith('/') ? path : `/${path}`,
    method: req.method,
    headers: { ...req.headers, host: targetUrl.host }
  }, upstreamRes => {
    res.writeHead(upstreamRes.statusCode, upstreamRes.headers);
    upstreamRes.pipe(res);
  });
  upstream.on('error', err => {
    console.log(`ERROR ${req.url} ${err.message}`);
    res.writeHead(502).end();
  });
  req.pipe(upstream);
}).listen(Number(port), '127.0.0.1', () => console.log(`LISTENING ${port}`));
