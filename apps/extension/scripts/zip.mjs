// Zips dist/chrome and dist/firefox into release/ for the GitHub release.
// Usage: node scripts/zip.mjs (after `pnpm build`). Needs the `zip` CLI.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const release = `${root}release`
mkdirSync(release, { recursive: true })

for (const target of ['chrome', 'firefox']) {
  const dir = `${root}dist/${target}`
  if (!existsSync(`${dir}/manifest.json`)) throw new Error(`Build ${dir} first (pnpm build)`)
  const { version } = JSON.parse(readFileSync(`${dir}/manifest.json`, 'utf8'))
  const out = `${release}/apartment-together-${target}-${version}.zip`
  rmSync(out, { force: true })
  execFileSync('zip', ['-qr', '-X', out, '.'], { cwd: dir, stdio: 'inherit' })
  console.log(out)
}
