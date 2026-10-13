import fs from 'node:fs'
import path from 'node:path'

/**
 * Checks the saved WhatsApp session. An empty or unparseable `creds.json` (e.g. the app was
 * killed mid-write) makes Baileys silently start a fresh login, so the user just sees
 * "Connecting…" forever. Such a folder is moved aside, not deleted, so linking starts clean.
 * Returns `{ ok: true }` or `{ ok: false, backup }` with the new folder name.
 */
export function checkAuthDir(dir) {
  const creds = path.join(dir, 'creds.json')
  if (!fs.existsSync(dir) || !fs.existsSync(creds)) return { ok: true }
  try {
    JSON.parse(fs.readFileSync(creds, 'utf8'))
    return { ok: true }
  } catch {
    const backup = `${dir}.bak-${Date.now()}`
    fs.renameSync(dir, backup)
    return { ok: false, backup }
  }
}
