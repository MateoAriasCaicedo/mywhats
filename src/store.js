/**
 * The chat store: chats, contact names and message history, kept in memory and
 * saved to a JSON file so history survives restarts.
 * @module store
 */
import fs from 'node:fs'
import path from 'node:path'
import { BufferJSON } from '@whiskeysockets/baileys'
import { imageMedia, isGroup, textOf, timestampOf } from './messages.js'

/** Messages kept per chat (oldest are dropped). */
export const MAX_MESSAGES_PER_CHAT = 500

/**
 * @typedef {object} Chat
 * @property {string|null} name Chat title, if WhatsApp gave one.
 * @property {number} last Timestamp (s) of the latest activity; used for ordering.
 * @property {number} unread Messages received while the chat was not open.
 *
 * @typedef {object} StoredMessage
 * @property {string} id
 * @property {number} ts Unix timestamp in seconds.
 * @property {boolean} fromMe
 * @property {string} who Sender's display name.
 * @property {string} text Text to display (see `textOf`).
 * @property {object} [media] Download info for images (see `imageMedia`).
 *
 * @typedef {object} Store
 * @property {Record<string, Chat>} chats By JID.
 * @property {Record<string, string>} contacts Names from your address book, by JID.
 * @property {Record<string, string>} names Self-chosen WhatsApp names (push names), by JID; a fallback.
 * @property {Record<string, StoredMessage[]>} messages By chat JID, oldest first.
 */

/** @returns {Store} */
export const emptyStore = () => ({ chats: {}, contacts: {}, names: {}, messages: {} })

/**
 * Loads the store from disk. A missing file gives an empty store; an unreadable
 * (corrupt) file is moved aside to `<file>.corrupt` so it is not overwritten. Parts of
 * the file that are missing or malformed fall back to empty.
 * @param {string|null} file Path, or null for an in-memory store.
 * @returns {Store}
 */
export function loadStore(file) {
  const store = emptyStore()
  if (!file) return store
  let raw
  try {
    raw = fs.readFileSync(file, 'utf8')
  } catch {
    return store
  }
  try {
    const data = JSON.parse(raw, BufferJSON.reviver)
    // Keep the defaults for any part that is missing or not an object (partial or hand-edited files).
    for (const key of Object.keys(store)) {
      if (data?.[key] && typeof data[key] === 'object' && !Array.isArray(data[key])) store[key] = data[key]
    }
    return store
  } catch {
    try { fs.renameSync(file, `${file}.corrupt`) } catch {}
    return store
  }
}

/**
 * Writes the store atomically (temp file, then rename).
 * @param {Store} store
 * @param {string} file
 * @returns {boolean} false if it could not be written.
 */
export function writeStore(store, file) {
  const tmp = `${file}.tmp`
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(tmp, JSON.stringify(store, BufferJSON.replacer))
    fs.renameSync(tmp, file)
    return true
  } catch {
    return false
  }
}

/**
 * Debounced saving: `save()` schedules a write, `flush()` writes now (e.g. on exit).
 * With no file both do nothing.
 * @param {Store} store
 * @param {string|null} file
 * @param {number} [delayMs]
 */
export function createSaver(store, file, delayMs = 500) {
  let timer
  const flush = () => {
    clearTimeout(timer)
    timer = undefined
    if (file) writeStore(store, file)
  }
  const save = () => {
    if (!file) return
    clearTimeout(timer)
    timer = setTimeout(flush, delayMs)
    timer.unref?.()
  }
  return { save, flush }
}

/**
 * Best name for a chat: your address-book name, its title, the name the person chose
 * for themselves, or the phone number.
 * @param {Store} store
 * @param {string} jid
 */
export function chatName(store, jid) {
  return store.contacts[jid] || store.chats[jid]?.name || store.names[jid] || jid.split('@')[0]
}

/**
 * Chat JIDs, most recently active first.
 * @param {Store} store
 */
export function orderedChats(store) {
  return Object.keys(store.chats).sort((a, b) => store.chats[b].last - store.chats[a].last)
}

/**
 * Adds a message to a chat's history. Ignores messages with nothing to show and
 * duplicates (same id).
 * @param {Store} store
 * @param {string} jid Chat the message belongs to.
 * @param {object} m A Baileys message.
 * @param {object} [options]
 * @param {boolean} [options.live] True for newly received messages (counts towards unread);
 *   false for history and messages you sent.
 * @param {string|null} [options.current] JID of the open chat; its messages are never unread.
 * @returns {boolean} true if the message was added.
 */
export function addMessage(store, jid, m, { live = false, current = null } = {}) {
  const text = textOf(m)
  if (text == null) return false
  const ts = timestampOf(m)
  const fromMe = !!m.key.fromMe
  const sender = m.key.participant || jid
  if (!fromMe && m.pushName) store.names[sender] = m.pushName
  const who = fromMe ? 'You' : store.contacts[sender] || m.pushName || store.names[sender] || sender.split('@')[0]

  const messages = (store.messages[jid] ||= [])
  if (messages.some((x) => x.id === m.key.id)) return false
  messages.push({ id: m.key.id, ts, fromMe, who, text, media: imageMedia(m) })
  messages.sort((a, b) => a.ts - b.ts)
  if (messages.length > MAX_MESSAGES_PER_CHAT) messages.splice(0, messages.length - MAX_MESSAGES_PER_CHAT)

  const chat = (store.chats[jid] ||= { name: null, last: 0, unread: 0 })
  chat.last = Math.max(chat.last, ts)
  if (live && !fromMe && jid !== current) chat.unread++
  if (!fromMe && !isGroup(jid) && m.pushName) store.names[jid] = m.pushName
  return true
}

/**
 * Records contact names: `name` is from your address book and wins; `notify` and
 * `verifiedName` are names the person (or business) chose and only fill the gaps.
 * @param {Store} store
 * @param {Array<{id: string, name?: string, notify?: string, verifiedName?: string}>} [contacts]
 */
export function ingestContacts(store, contacts = []) {
  for (const c of contacts) {
    if (c.name) store.contacts[c.id] = c.name
    const chosen = c.notify || c.verifiedName
    if (chosen) store.names[c.id] = chosen
  }
}

/**
 * Creates or updates chat entries (title and latest activity) from WhatsApp's chat list.
 * @param {Store} store
 * @param {Array<{id: string, name?: string, conversationTimestamp?: unknown}>} chats
 */
export function upsertChats(store, chats) {
  for (const c of chats) {
    const entry = (store.chats[c.id] ||= { name: null, last: 0, unread: 0 })
    if (c.name) entry.name = c.name
    entry.last = Math.max(entry.last, Number(c.conversationTimestamp) || 0)
  }
}
