// OLX group CDN (apollo.olxcdn.com) serves Otodom and OLX images; the size is in ";s=WxH".
const APOLLO_SIZE = /;s=(\d+x\d+|\{width\}x\{height\})/

export function apolloSized(url: string, size: string): string {
  if (url.includes('{width}x{height}')) return url.replace('{width}x{height}', size)
  return APOLLO_SIZE.test(url) ? url.replace(APOLLO_SIZE, `;s=${size}`) : url
}

export const MEDIUM = '1280x960'
export const THUMB = '400x300'
