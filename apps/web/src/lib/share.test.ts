import { describe, expect, it } from 'vitest'
import { adoptShareParams, readShared } from './share'

function run(url: string) {
  const u = new URL(url)
  let replaced: string | null = null
  adoptShareParams(
    { pathname: u.pathname, search: u.search, hash: u.hash },
    { state: null, replaceState: (_s, _t, next) => void (replaced = String(next)) },
  )
  return replaced
}

describe('adoptShareParams', () => {
  it('moves the shared values into the #/add route query', () => {
    expect(
      run(
        'https://me.github.io/repo/?title=Flat&text=Look&url=https%3A%2F%2Fwww.otodom.pl%2Fx#/add',
      ),
    ).toBe('/repo/#/add?url=https%3A%2F%2Fwww.otodom.pl%2Fx&text=Look&title=Flat')
  })

  it('keeps unrelated query params (e.g. an auth code) in place', () => {
    expect(run('http://localhost:5173/?code=abc&text=see+https://olx.pl/d/1#/add')).toBe(
      '/?code=abc#/add?text=see+https%3A%2F%2Folx.pl%2Fd%2F1',
    )
  })

  it('leaves other routes and plain loads alone', () => {
    expect(run('http://localhost:5173/?url=https://x.pl#/hunts')).toBeNull()
    expect(run('http://localhost:5173/#/add')).toBeNull()
    expect(run('http://localhost:5173/?code=abc')).toBeNull()
  })
})

describe('readShared', () => {
  it('prefers the url param', () => {
    expect(readShared({ url: 'https://www.otodom.pl/a', text: 'see https://olx.pl/b' })).toEqual({
      url: 'https://www.otodom.pl/a',
      text: 'see https://olx.pl/b',
    })
  })

  it('finds the link inside the text when url is empty', () => {
    expect(
      readShared({ url: '', text: 'Check this flat! https://www.olx.pl/d/oferta/x.html.' }).url,
    ).toBe('https://www.olx.pl/d/oferta/x.html')
  })

  it('falls back to the text flow without a link', () => {
    expect(readShared({ title: '3 pokoje Mokotów', text: '4200 zł, 62 m2' })).toEqual({
      url: null,
      text: '3 pokoje Mokotów\n4200 zł, 62 m2',
    })
  })
})
