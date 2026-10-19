// Small regex-based HTML helpers. Adapters run in Deno (edge function) and in the
// extension on document.documentElement.outerHTML, so there's no DOM to rely on.

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
}

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code: string) => {
    if (code[0] === '#') {
      const n =
        code[1] === 'x' || code[1] === 'X'
          ? parseInt(code.slice(2), 16)
          : parseInt(code.slice(1), 10)
      return Number.isFinite(n) ? String.fromCodePoint(n) : m
    }
    return ENTITIES[code.toLowerCase()] ?? m
  })
}

/** Strips tags and collapses whitespace, keeping paragraph breaks. */
export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
      .replace(/<[^>]+>/g, ''),
  )
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function attr(tag: string, name: string): string | undefined {
  const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'))
  if (!m) return undefined
  return decodeEntities(m[2] ?? m[3] ?? m[4] ?? '')
}

/** Raw contents of every <script> whose opening tag matches the predicate. */
export function scriptContents(html: string, match: (openTag: string) => boolean): string[] {
  const out: string[] = []
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi
  for (const m of html.matchAll(re)) {
    if (match(m[1] ?? '')) out.push(m[2] ?? '')
  }
  return out
}

export function scriptById(html: string, id: string): string | undefined {
  return scriptContents(html, (tag) => attr(tag, 'id') === id)[0]
}

export function safeJsonParse(s: string | undefined): unknown {
  if (!s) return undefined
  try {
    return JSON.parse(s)
  } catch {
    return undefined
  }
}

/** All JSON-LD objects on the page, with @graph arrays flattened. */
export function jsonLd(html: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = []
  const push = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(push)
    else if (v && typeof v === 'object') {
      const obj = v as Record<string, unknown>
      out.push(obj)
      if (Array.isArray(obj['@graph'])) push(obj['@graph'])
    }
  }
  for (const s of scriptContents(html, (tag) =>
    /application\/ld\+json/i.test(attr(tag, 'type') ?? ''),
  )) {
    push(safeJsonParse(s.trim()))
  }
  return out
}

/** <meta property|name="key" content="…">, first match. */
export function meta(html: string, key: string): string | undefined {
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = m[0]
    if (attr(tag, 'property') === key || attr(tag, 'name') === key) {
      const content = attr(tag, 'content')
      if (content) return content.trim()
    }
  }
  return undefined
}

export function metaAll(html: string, key: string): string[] {
  const out: string[] = []
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = m[0]
    if (attr(tag, 'property') === key || attr(tag, 'name') === key) {
      const content = attr(tag, 'content')
      if (content) out.push(content.trim())
    }
  }
  return out
}

export function title(html: string): string | undefined {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  return m ? decodeEntities(m[1]!).trim() || undefined : undefined
}
