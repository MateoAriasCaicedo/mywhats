/**
 * Pure formatting helpers: turn data into the blessed-tagged strings the UI prints.
 * Nothing here touches the screen, which keeps it easy to test.
 * @module format
 */

/** Colours (hex, readable on a light terminal). */
export const COLORS = {
  accent: '#0969da',
  info: '#0550ae',
  recording: '#a40e26',
  muted: 'gray',
}

/** Colours given to other people's names; one is picked per name. */
export const PALETTE = ['#0550ae', '#6639ba', '#1b7c83', '#7d4e00', '#a40e26']

/** Header label for each connection state. An empty label is not shown. */
export const CONNECTION_LABELS = {
  open: '',
  connecting: 'connecting',
  close: 'reconnecting',
  demo: 'demo',
  loggedOut: 'logged out',
}

/**
 * Escapes text so blessed does not treat `{...}` in it as a style tag.
 * @param {unknown} text
 * @returns {string}
 */
export function esc(text) {
  return String(text).replace(/[{}]/g, (ch) => (ch === '{' ? '{open}' : '{close}'))
}

/**
 * Wraps text in a blessed foreground-colour tag.
 * @param {string} color
 * @param {string} text Already escaped text.
 */
export const colored = (color, text) => `{${color}-fg}${text}{/}`

/**
 * Local "HH:MM" for a Unix timestamp in seconds.
 * @param {number} ts
 */
export function timeOf(ts) {
  return new Date(ts * 1000).toTimeString().slice(0, 5)
}

/**
 * "Today", "Yesterday" or a short date, by calendar day in local time.
 * @param {number} ts Unix timestamp in seconds.
 * @param {number} [now] Current time in ms (injectable for tests).
 */
export function dayLabel(ts, now = Date.now()) {
  const startOfDay = (ms) => new Date(ms).setHours(0, 0, 0, 0)
  const days = Math.round((startOfDay(now) - startOfDay(ts * 1000)) / 864e5)
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  return new Date(ts * 1000).toLocaleDateString(undefined, {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
  })
}

/**
 * Stable colour for a name, so the same person always gets the same colour.
 * @param {string} name
 */
export function colorOf(name) {
  const hash = [...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7)
  return PALETTE[hash % PALETTE.length]
}

/**
 * "m:ss" for a number of seconds.
 * @param {number} totalSeconds
 */
export function formatDuration(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}



/** One row of your own message: right-aligned (blessed's {right} tag), one column from the edge. */
function mineRow(line) {
  return `{right}${esc(line)} {/right}`
}

/**
 * Formats one stored message as a chat transcript: other people's messages on the left,
 * yours right-aligned, with no names, markers or times. Every line on the left has a
 * one-column margin. A blank line separates your messages from theirs, and a dim rule
 * marks a new day.
 * @param {{ts: number, fromMe: boolean, text: string}} m
 * @param {{day: string, fromMe: boolean}|null} prev What the previous call returned as
 *   `state` (null for the first message of a chat).
 * @param {number} [now] Current time in ms (injectable for tests).
 * @returns {{lines: string[], state: {day: string, fromMe: boolean}}}
 */
export function formatMessage(m, prev, now = Date.now()) {
  const lines = []
  const day = dayLabel(m.ts, now)
  const newDay = day !== prev?.day
  if (newDay) lines.push(colored(COLORS.muted, ` ── ${esc(day)} ──`))
  if (!newDay && prev && prev.fromMe !== m.fromMe) lines.push('')
  for (const line of String(m.text).split(/\r?\n/)) lines.push(m.fromMe ? mineRow(line) : ` ${esc(line)}`)
  return { lines, state: { day, fromMe: m.fromMe } }
}

/** Frames of the activity spinner (the ones Claude Code cycles through). */
export const SPINNER_FRAMES = ['·', '✢', '✳', '✶', '✻', '✽']

/**
 * Content of the one-line header: the chat title on the left, status on the right
 * (recording timer, connection state, unread count).
 * @param {object} p
 * @param {string} p.title
 * @param {number} p.width Terminal width.
 * @param {string} p.connection Key of {@link CONNECTION_LABELS} (or any literal label).
 * @param {number} p.unreadChats Number of chats with unread messages.
 * @param {number|null} [p.recordingSeconds] Seconds recorded so far, or null when idle.
 * @param {string|null} [p.activity] What the app is busy with ("Sending…"), shown with a spinner.
 * @param {number} [p.frame] Spinner animation step.
 */
export function headerContent({ title, width, connection, unreadChats, recordingSeconds = null, activity = null, frame = 0 }) {
  /** @type {Array<[string, string]>} */
  const parts = []
  if (recordingSeconds != null) parts.push([`● rec ${formatDuration(recordingSeconds)}`, COLORS.recording])
  if (activity) parts.push([`${SPINNER_FRAMES[frame % SPINNER_FRAMES.length]} ${activity}`, COLORS.accent])
  const label = CONNECTION_LABELS[connection] ?? connection
  if (label) parts.push([label, COLORS.muted])
  if (unreadChats) parts.push([`${unreadChats} unread`, COLORS.info])
  const plain = parts.map(([text]) => text).join(' · ')
  const right = parts.map(([text, color]) => colored(color, esc(text))).join(colored(COLORS.muted, ' · '))
  // 2 columns of padding are added by the header widget.
  const gap = Math.max(1, width - 2 - [...title].length - [...plain].length)
  return `{bold}${esc(title)}{/bold}${' '.repeat(gap)}${right}`
}
