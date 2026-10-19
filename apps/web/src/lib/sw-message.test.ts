import { describe, expect, it } from 'vitest'
import { appUrl, toNotification } from './sw-message'

const SCOPE = 'https://me.github.io/repo/'

describe('toNotification', () => {
  it('shows the message from send-push and links into the app', () => {
    const shown = toNotification(
      JSON.stringify({
        title: 'Ala added a listing',
        body: 'Sunny flat',
        url: '#/h/h1/l/l1',
        tag: 'listing_added:l1',
        notificationId: 'n1',
      }),
      SCOPE,
    )
    expect(shown).toEqual({
      title: 'Ala added a listing',
      options: {
        body: 'Sunny flat',
        tag: 'listing_added:l1',
        icon: 'https://me.github.io/repo/pwa-192.png',
        badge: 'https://me.github.io/repo/pwa-192.png',
        data: { url: 'https://me.github.io/repo/#/h/h1/l/l1', notificationId: 'n1' },
      },
    })
  })

  it('still shows something for empty or broken payloads', () => {
    expect(toNotification(undefined, SCOPE)).toMatchObject({
      title: 'ApartmentTogether',
      options: { body: '', data: { url: SCOPE } },
    })
    expect(toNotification('plain text', SCOPE)).toMatchObject({
      title: 'ApartmentTogether',
      options: { body: 'plain text' },
    })
  })
})

describe('appUrl', () => {
  it('only opens hash routes inside the app', () => {
    expect(appUrl('#/notifications', SCOPE)).toBe('https://me.github.io/repo/#/notifications')
    expect(appUrl('https://evil.example/', SCOPE)).toBe(SCOPE)
    expect(appUrl('', SCOPE)).toBe(SCOPE)
  })
})
