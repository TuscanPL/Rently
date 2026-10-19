// localStorage can throw (private mode, blocked storage); never let that break the app.
export function readLocal(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

export function writeLocal(key: string, value: string | null): void {
  try {
    if (value == null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    // ignore
  }
}

export const LAST_HUNT_KEY = 'at.lastHunt'
export const POST_LOGIN_KEY = 'at.postLogin'
export const INSTALL_DISMISSED_KEY = 'at.installDismissed'
