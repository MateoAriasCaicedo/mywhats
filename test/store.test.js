import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  MAX_MESSAGES_PER_CHAT, addMessage, chatName, createSaver, emptyStore, ingestContacts,
  loadStore, orderedChats, upsertChats, writeStore,
} from '../src/store.js'

const ALICE = '111@s.whatsapp.net'
const GROUP = '333@g.us'

/** A Baileys-shaped text message. */
const msg = (id, text, { ts = 1000, fromMe = false, pushName = 'Alice', participant } = {}) => ({
  key: { id, fromMe, remoteJid: ALICE, participant },
  pushName,
  messageTimestamp: ts,
  message: { conversation: text },
})

/** A throwaway directory, removed after the test. */
function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mywhats-test-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  return dir
}

test('addMessage stores the message and creates the chat', () => {
  const store = emptyStore()
  assert.equal(addMessage(store, ALICE, msg('1', 'hi', { ts: 1234 })), true)
  assert.deepEqual(store.messages[ALICE].map(({ id, ts, fromMe, who, text }) => ({ id, ts, fromMe, who, text })), [
    { id: '1', ts: 1234, fromMe: false, who: 'Alice', text: 'hi' },
  ])
  assert.equal(store.chats[ALICE].last, 1234)
  assert.equal(store.chats[ALICE].unread, 0)
})

test('addMessage ignores duplicates and messages with nothing to show', () => {
  const store = emptyStore()
  addMessage(store, ALICE, msg('1', 'hi'))
  assert.equal(addMessage(store, ALICE, msg('1', 'hi again')), false)
  assert.equal(addMessage(store, ALICE, { key: { id: '2' }, message: { reactionMessage: {} } }), false)
  assert.equal(store.messages[ALICE].length, 1)
})

test('addMessage keeps messages in time order', () => {
  const store = emptyStore()
  addMessage(store, ALICE, msg('late', 'b', { ts: 2000 }))
  addMessage(store, ALICE, msg('early', 'a', { ts: 1000 }))
  assert.deepEqual(store.messages[ALICE].map((m) => m.id), ['early', 'late'])
  assert.equal(store.chats[ALICE].last, 2000)
})

test(`addMessage keeps only the latest ${MAX_MESSAGES_PER_CHAT} messages per chat`, () => {
  const store = emptyStore()
  for (let i = 0; i < MAX_MESSAGES_PER_CHAT + 5; i++) addMessage(store, ALICE, msg(`m${i}`, 'x', { ts: i + 1 }))
  const ids = store.messages[ALICE].map((m) => m.id)
  assert.equal(ids.length, MAX_MESSAGES_PER_CHAT)
  assert.equal(ids[0], 'm5')
})

test('addMessage counts unread only for live incoming messages in other chats', () => {
  const store = emptyStore()
  addMessage(store, ALICE, msg('1', 'a'), { live: true, current: null })
  addMessage(store, ALICE, msg('2', 'b'), { live: true, current: GROUP })
  assert.equal(store.chats[ALICE].unread, 2)

  addMessage(store, ALICE, msg('3', 'c'), { live: true, current: ALICE }) // chat is open
  addMessage(store, ALICE, msg('4', 'd'), { live: false }) // history
  addMessage(store, ALICE, msg('5', 'e', { fromMe: true }), { live: true }) // sent by you
  assert.equal(store.chats[ALICE].unread, 2)
})

test('addMessage names senders: pushName, remembered name, or number', () => {
  const store = emptyStore()
  addMessage(store, GROUP, msg('1', 'hi', { participant: '555@s.whatsapp.net', pushName: 'Carol' }))
  assert.equal(store.messages[GROUP][0].who, 'Carol')
  assert.equal(store.names['555@s.whatsapp.net'], 'Carol')
  assert.equal(store.names[GROUP], undefined) // a group is not named after a member

  addMessage(store, GROUP, msg('2', 'again', { participant: '555@s.whatsapp.net', pushName: null }))
  assert.equal(store.messages[GROUP][1].who, 'Carol')

  addMessage(store, GROUP, msg('3', 'who?', { participant: '777@s.whatsapp.net', pushName: null }))
  assert.equal(store.messages[GROUP][2].who, '777')
})

test('addMessage labels your own messages "You" and remembers private chat names', () => {
  const store = emptyStore()
  addMessage(store, ALICE, msg('1', 'hi', { fromMe: true }))
  assert.equal(store.messages[ALICE][0].who, 'You')
  addMessage(store, ALICE, msg('2', 'hey'))
  assert.equal(store.names[ALICE], 'Alice')
})

test('addMessage keeps the download info of images', () => {
  const store = emptyStore()
  addMessage(store, ALICE, {
    key: { id: 'img', fromMe: false, remoteJid: ALICE },
    messageTimestamp: 5,
    message: { imageMessage: { caption: 'cat', mediaKey: Buffer.from('k') } },
  })
  const [stored] = store.messages[ALICE]
  assert.equal(stored.text, '[image] cat')
  assert.ok(stored.media.message.imageMessage.mediaKey)
})

test('chatName prefers your address-book name, then the chat title, then the pushed name, then the number', () => {
  const store = emptyStore()
  assert.equal(chatName(store, ALICE), '111')
  store.names[ALICE] = 'Ally'
  assert.equal(chatName(store, ALICE), 'Ally')
  store.chats[ALICE] = { name: 'Alice', last: 0, unread: 0 }
  assert.equal(chatName(store, ALICE), 'Alice')
  store.contacts[ALICE] = 'Mom'
  assert.equal(chatName(store, ALICE), 'Mom')
})

test('orderedChats lists the most recently active first', () => {
  const store = emptyStore()
  store.chats.a = { name: 'a', last: 10, unread: 0 }
  store.chats.b = { name: 'b', last: 30, unread: 0 }
  store.chats.c = { name: 'c', last: 20, unread: 0 }
  assert.deepEqual(orderedChats(store), ['b', 'c', 'a'])
})

test('ingestContacts keeps address-book names apart from self-chosen ones', () => {
  const store = emptyStore()
  ingestContacts(store, [
    { id: 'a', name: 'A', notify: 'x' },
    { id: 'b', notify: 'B' },
    { id: 'c', verifiedName: 'C' },
    { id: 'd' },
  ])
  assert.deepEqual(store.contacts, { a: 'A' })
  assert.deepEqual(store.names, { a: 'x', b: 'B', c: 'C' })
  assert.doesNotThrow(() => ingestContacts(store))
})

test('upsertChats sets titles and never moves the activity time backwards', () => {
  const store = emptyStore()
  upsertChats(store, [{ id: 'a', name: 'Team', conversationTimestamp: 50 }])
  upsertChats(store, [{ id: 'a', conversationTimestamp: 10 }, { id: 'b' }])
  assert.equal(store.chats.a.name, 'Team')
  assert.equal(store.chats.a.last, 50)
  assert.deepEqual(store.chats.b, { name: null, last: 0, unread: 0 })
})

test('writeStore and loadStore round-trip, including binary media keys', (t) => {
  const file = path.join(tempDir(t), 'data', 'store.json') // directory is created on demand
  const store = emptyStore()
  const mediaKey = Buffer.from([1, 2, 3, 250])
  addMessage(store, ALICE, {
    key: { id: 'img', fromMe: false, remoteJid: ALICE },
    messageTimestamp: 5,
    message: { imageMessage: { mediaKey } },
  })
  assert.equal(writeStore(store, file), true)

  const loaded = loadStore(file)
  assert.deepEqual(loaded.chats, store.chats)
  const restored = loaded.messages[ALICE][0].media.message.imageMessage.mediaKey
  assert.ok(Buffer.isBuffer(restored))
  assert.deepEqual([...restored], [1, 2, 3, 250])
  assert.equal(fs.existsSync(`${file}.tmp`), false)
})

test('loadStore gives an empty store for a missing file or no file', (t) => {
  assert.deepEqual(loadStore(path.join(tempDir(t), 'nope.json')), emptyStore())
  assert.deepEqual(loadStore(null), emptyStore())
})

test('loadStore moves a corrupt file aside instead of overwriting it', (t) => {
  const file = path.join(tempDir(t), 'store.json')
  fs.writeFileSync(file, '{not json')
  assert.deepEqual(loadStore(file), emptyStore())
  assert.equal(fs.existsSync(file), false)
  assert.equal(fs.readFileSync(`${file}.corrupt`, 'utf8'), '{not json')
})

test('loadStore keeps defaults for missing or malformed parts of the file', (t) => {
  const file = path.join(tempDir(t), 'store.json')
  fs.writeFileSync(file, JSON.stringify({ chats: { a: { name: 'A', last: 1, unread: 0 } }, names: [], messages: 'oops' }))
  const loaded = loadStore(file)
  assert.equal(loaded.chats.a.name, 'A')
  assert.deepEqual(loaded.names, {})
  assert.deepEqual(loaded.messages, {})
  fs.writeFileSync(file, '[]') // valid JSON but not a store
  assert.deepEqual(loadStore(file), emptyStore())
})

test('writeStore reports failure instead of throwing', (t) => {
  const dir = tempDir(t)
  const blocker = path.join(dir, 'file')
  fs.writeFileSync(blocker, 'x')
  assert.equal(writeStore(emptyStore(), path.join(blocker, 'store.json')), false) // parent is a file
})

test('createSaver flush writes immediately', (t) => {
  const file = path.join(tempDir(t), 'store.json')
  const store = emptyStore()
  const saver = createSaver(store, file)
  store.names.x = 'X'
  saver.flush()
  assert.equal(loadStore(file).names.x, 'X')
})

test('createSaver save is debounced', async (t) => {
  const file = path.join(tempDir(t), 'store.json')
  const store = emptyStore()
  const saver = createSaver(store, file, 20)
  saver.save()
  store.names.x = 'later'
  saver.save()
  assert.equal(fs.existsSync(file), false) // nothing yet
  await new Promise((resolve) => setTimeout(resolve, 80))
  assert.equal(loadStore(file).names.x, 'later') // one write, with the latest data
})

test('createSaver with no file does nothing', () => {
  const saver = createSaver(emptyStore(), null)
  assert.doesNotThrow(() => { saver.save(); saver.flush() })
})
