import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  COLORS, PALETTE, colorOf, colored, dayLabel, esc, formatDuration, formatMessage, headerContent, timeOf,
} from '../src/format.js'

/** Local-time Unix timestamp (s) so tests do not depend on the machine's time zone. */
const at = (y, mo, d, h = 12, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime() / 1000
const NOW = at(2024, 6, 15) * 1000
/** Removes blessed tags (not the escaped `{open}`/`{close}`). */
const plain = (s) => s.replace(/\{(?!open\}|close\})[^}]*\}/g, '')

test('esc escapes braces so blessed does not read them as tags', () => {
  assert.equal(esc('{bold}hi{/bold}'), '{open}bold{close}hi{open}/bold{close}')
  assert.equal(esc(42), '42')
})

test('colored wraps text in a foreground tag', () => {
  assert.equal(colored('#fff', 'x'), '{#fff-fg}x{/}')
})

test('timeOf gives local HH:MM', () => {
  assert.equal(timeOf(at(2024, 1, 15, 14, 5)), '14:05')
  assert.equal(timeOf(at(2024, 1, 15, 0, 0)), '00:00')
})

test('dayLabel says Today, Yesterday, or a dated label', () => {
  assert.equal(dayLabel(at(2024, 6, 15, 0, 1), NOW), 'Today')
  assert.equal(dayLabel(at(2024, 6, 14, 23, 59), NOW), 'Yesterday')
  const old = dayLabel(at(2024, 6, 1), NOW)
  assert.match(old, /2024/)
  assert.notEqual(old, 'Today')
  assert.notEqual(old, 'Yesterday')
})

test('colorOf is stable and comes from the palette', () => {
  assert.equal(colorOf('Alice'), colorOf('Alice'))
  assert.ok(PALETTE.includes(colorOf('Alice')))
  assert.ok(PALETTE.includes(colorOf('')))
})

test('formatDuration prints m:ss', () => {
  assert.equal(formatDuration(0), '0:00')
  assert.equal(formatDuration(5.9), '0:05')
  assert.equal(formatDuration(65), '1:05')
  assert.equal(formatDuration(3600), '60:00')
  assert.equal(formatDuration(-3), '0:00')
})

test('formatMessage starts with a day label, then time, name and text', () => {
  const m = { ts: at(2024, 6, 15, 9, 30), fromMe: false, who: 'Alice', text: 'hi there' }
  const { lines, day } = formatMessage(m, null, NOW)
  assert.equal(day, 'Today')
  assert.equal(lines.length, 2)
  assert.equal(plain(lines[0]), 'Today')
  assert.equal(plain(lines[1]), '09:30 Alice hi there')
})

test('formatMessage skips the day label when the day is unchanged', () => {
  const m = { ts: at(2024, 6, 15, 9, 30), fromMe: false, who: 'Alice', text: 'hi' }
  assert.equal(formatMessage(m, 'Today', NOW).lines.length, 1)
})

test('formatMessage shows no name for your own messages', () => {
  const m = { ts: at(2024, 6, 15, 9, 30), fromMe: true, who: 'You', text: 'mine' }
  assert.equal(plain(formatMessage(m, 'Today', NOW).lines[0]), '09:30 mine')
})

test('formatMessage indents extra lines and escapes braces', () => {
  const m = { ts: at(2024, 6, 15, 9, 30), fromMe: true, who: 'You', text: 'a {b}\r\nsecond\nthird' }
  const { lines } = formatMessage(m, 'Today', NOW)
  assert.equal(lines.length, 3)
  assert.match(lines[0], /a \{open\}b\{close\}$/)
  assert.equal(lines[1], '      second')
  assert.equal(lines[2], '      third')
})

test('headerContent right-aligns status to the terminal width', () => {
  const out = plain(headerContent({ title: 'Alice', width: 40, connection: 'connecting', unreadChats: 2 }))
  assert.ok(out.startsWith('Alice'))
  assert.ok(out.endsWith('connecting · 2 unread'))
  assert.equal([...out].length, 40 - 2) // the widget adds 1 column of padding each side
})

test('headerContent hides the label of an open connection and shows nothing else when idle', () => {
  const out = plain(headerContent({ title: 'Alice', width: 30, connection: 'open', unreadChats: 0 }))
  assert.equal(out.trim(), 'Alice')
})

test('headerContent shows the recording timer in the recording colour', () => {
  const raw = headerContent({ title: '', width: 40, connection: 'open', unreadChats: 0, recordingSeconds: 75 })
  assert.match(plain(raw), /● rec 1:15/)
  assert.ok(raw.includes(COLORS.recording))
})

test('headerContent never overflows with a long title', () => {
  const out = plain(headerContent({ title: 'x'.repeat(100), width: 20, connection: 'demo', unreadChats: 1 }))
  assert.ok(out.endsWith('demo · 1 unread'))
})
