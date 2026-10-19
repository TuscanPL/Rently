import { ext } from './ext.ts'

// Reading the page the user is looking at. activeTab grants access to it when
// the user clicks the toolbar button, and only then; no content scripts run otherwise.

export interface PageSnapshot {
  url: string
  html: string
}

/**
 * The tab to read: the active tab of the current window, or the one named by
 * ?tabId= (lets the popup run in a normal tab for debugging and e2e tests).
 */
export async function targetTab(): Promise<chrome.tabs.Tab | undefined> {
  const tabId = Number(new URLSearchParams(location.search).get('tabId'))
  if (tabId) return ext.tabs.get(tabId)
  const [tab] = await ext.tabs.query({ active: true, currentWindow: true })
  return tab
}

/** The live DOM as HTML, after the site's scripts ran (so it works where server-side fetches are blocked). */
export async function snapshot(tab: chrome.tabs.Tab): Promise<PageSnapshot> {
  if (tab.id == null || !tab.url) throw new Error('No page to read in this tab.')
  const [injection] = await ext.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => document.documentElement.outerHTML,
  })
  const html = injection?.result
  if (typeof html !== 'string') throw new Error('Could not read this page.')
  return { url: tab.url, html }
}
