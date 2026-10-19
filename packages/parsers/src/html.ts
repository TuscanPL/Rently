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

/** Text of the first <h1>. */
export function h1(html: string): string | undefined {
  const m = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)
  return m ? htmlToText(m[1]!) || undefined : undefined
}

/** Text of the first element whose attribute matches (see element()). */
export function elementText(html: string, name: string, value: RegExp): string | undefined {
  const inner = element(html, name, value)
  return inner ? htmlToText(inner).replace(/\s+/g, ' ').trim() || undefined : undefined
}

/**
 * Inner HTML of the first element whose attribute matches, e.g.
 * element(html, 'class', /\bgallery\b/). Nesting is balanced on the element's own
 * tag name only, which is enough for the containers adapters look at.
 */
export function element(html: string, name: string, value: RegExp): string | undefined {
  const open = new RegExp(`<([a-z][\\w-]*)\\b[^>]*\\s${name}\\s*=\\s*("[^"]*"|'[^']*')[^>]*>`, 'gi')
  for (const m of html.matchAll(open)) {
    if (!value.test(m[2]!.slice(1, -1))) continue
    const tag = m[1]!.toLowerCase()
    const start = m.index + m[0].length
    if (m[0].endsWith('/>')) return ''
    const re = new RegExp(`<(/?)${tag}\\b[^>]*>`, 'gi')
    re.lastIndex = start
    let depth = 1
    for (let t = re.exec(html); t; t = re.exec(html)) {
      if (t[1]) depth--
      else if (!t[0].endsWith('/>')) depth++
      if (depth === 0) return html.slice(start, t.index)
    }
    return html.slice(start)
  }
  return undefined
}

/**
 * Visible text split at every tag, one trimmed non-empty line per text node.
 * Label/value markup ("<dt>Piętro</dt><dd>3/5</dd>") becomes two lines.
 */
export function textLines(html: string): string[] {
  return decodeEntities(
    html
      .replace(/<(script|style|svg|noscript|template)\b[\s\S]*?<\/\1>/gi, '')
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<sup>\s*2\s*<\/sup>/gi, '²')
      .replace(/<[^>]+>/g, '\n'),
  )
    .split('\n')
    .map((l) => l.replace(/[\s ]+/g, ' ').trim())
    .filter(Boolean)
}

const VALUE_ATTR: Record<string, string> = {
  meta: 'content',
  link: 'href',
  a: 'href',
  img: 'src',
  source: 'src',
  time: 'datetime',
  data: 'value',
}

/**
 * schema.org microdata: every itemprop's values in page order, flattened (nested
 * itemscopes are not kept apart). Values come from content/href/src/datetime,
 * or the element's text.
 */
export function itemprops(html: string): Map<string, string[]> {
  const out = new Map<string, string[]>()
  const re = /<([a-z][\w-]*)\b([^>]*\sitemprop\s*=\s*("[^"]*"|'[^']*')[^>]*)>/gi
  for (const m of html.matchAll(re)) {
    const tag = m[1]!.toLowerCase()
    const attrs = m[2]!
    const valueAttr = VALUE_ATTR[tag]
    let value = attr(attrs, 'content') ?? (valueAttr ? attr(attrs, valueAttr) : undefined)
    if (value == null && !/\sitemscope\b/i.test(attrs) && !m[0].endsWith('/>')) {
      const close = new RegExp(`</${tag}\\s*>`, 'gi')
      close.lastIndex = m.index + m[0].length
      const end = close.exec(html)
      if (end) value = htmlToText(html.slice(m.index + m[0].length, end.index))
    }
    if (value == null || value.trim() === '') continue
    for (const n of m[3]!.slice(1, -1).trim().split(/\s+/)) {
      const values = out.get(n) ?? []
      values.push(value.trim())
      out.set(n, values)
    }
  }
  return out
}

/** First value of a data-* attribute anywhere on the page, e.g. dataAttr(html, 'lat'). */
export function dataAttr(html: string, name: string): string | undefined {
  const m = html.match(new RegExp(`\\sdata-${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i'))
  return m ? decodeEntities(m[1] ?? m[2] ?? '').trim() || undefined : undefined
}

export interface ImageCandidate {
  src: string
  /** srcset entries with a width descriptor, smallest first. */
  srcset: { url: string; w: number }[]
}

/** Every <img> in a chunk of HTML, in order, with lazy-loading attributes resolved. */
export function imageCandidates(html: string): ImageCandidate[] {
  const out: ImageCandidate[] = []
  for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
    const tag = m[0]
    const srcset = (attr(tag, 'data-srcset') ?? attr(tag, 'srcset') ?? '')
      .split(/,\s+/)
      .map((entry) => {
        const [u, d] = entry.trim().split(/\s+/)
        return { url: u ?? '', w: Number(d?.match(/^(\d+)w$/)?.[1] ?? NaN) }
      })
      .filter((e) => /^https?:\/\//.test(e.url) && Number.isFinite(e.w))
      .sort((a, b) => a.w - b.w)
    const src = [attr(tag, 'data-src'), attr(tag, 'data-lazy'), attr(tag, 'src')].find(
      (s) => s && /^https?:\/\//.test(s),
    )
    const best = src ?? srcset[srcset.length - 1]?.url
    if (best) out.push({ src: best, srcset })
  }
  return out
}
