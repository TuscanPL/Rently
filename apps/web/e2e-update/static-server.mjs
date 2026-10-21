// A tiny static server for the update test: unlike `vite preview` it reads files
// from disk on every request, so a rebuild in the middle of the test is served.
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'

const [root, port] = [process.argv[2], Number(process.argv[3] ?? 4180)]
const TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
}

createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(
    /^(\.\.[/\\])+/,
    '',
  )
  const file = join(root, path.endsWith('/') ? `${path}index.html` : path)
  try {
    const body = await readFile(file)
    res.writeHead(200, {
      'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream',
      'Cache-Control': 'no-cache',
    })
    res.end(body)
  } catch {
    res.writeHead(404).end('not found')
  }
}).listen(port, () => console.log(`serving ${root} on ${port}`))
