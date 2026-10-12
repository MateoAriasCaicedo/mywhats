import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEMO_CHATS, DEMO_REPLIES, createDemoSocket, seedDemoStore } from '../src/demo.js'
import { addMessage, emptyStore } from '../src/store.js'

const NOW = 1_700_000_000

test('seedDemoStore creates every demo chat with its messages, oldest first', () => {
  const store = emptyStore()
  seedDemoStore(store, NOW)
  assert.equal(Object.keys(store.chats).length, DEMO_CHATS.length)
  for (const [jid, name, messages] of DEMO_CHATS) {
    assert.equal(store.chats[jid].name, name)
    assert.equal(store.messages[jid].length, messages.length)
    const times = store.messages[jid].map((m) => m.ts)
    assert.deepEqual(times, [...times].sort((a, b) => a - b))
  }
})

test('seedDemoStore includes an image that /view can open, and leaves nothing unread', () => {
  const store = emptyStore()
  seedDemoStore(store, NOW)
  const images = Object.values(store.messages).flat().filter((m) => m.media)
  assert.equal(images.length, 1)
  assert.equal(images[0].text, '[image] Menu for today')
  assert.ok(Object.values(store.chats).every((c) => c.unread === 0))
})

test('the demo socket returns the sent message with a unique id each time', async () => {
  const { sock } = createDemoSocket({ store: emptyStore(), deliver() {}, delayMs: 1 })
  const a = await sock.sendMessage('111@s.whatsapp.net', { text: 'one' })
  const b = await sock.sendMessage('111@s.whatsapp.net', { text: 'two' })
  assert.notEqual(a.key.id, b.key.id)
  assert.equal(a.key.fromMe, true)
  assert.equal(a.message.conversation, 'one')
})

test('sent messages are shown as the right kind of content', async () => {
  const { sock } = createDemoSocket({ store: emptyStore(), deliver() {}, delayMs: 1 })
  const audio = await sock.sendMessage('x', { audio: Buffer.from('a'), ptt: true })
  const image = await sock.sendMessage('x', { image: Buffer.from('i'), caption: 'cat' })
  assert.deepEqual(audio.message, { audioMessage: {} })
  assert.equal(image.message.imageMessage.caption, 'cat')
  const store = emptyStore()
  assert.equal(addMessage(store, 'x', image), true) // the store can read what the socket returns
  assert.equal(store.messages.x[0].text, '[image] cat')
})

test('the demo socket delivers a reply from the chat after a delay', async () => {
  const store = emptyStore()
  seedDemoStore(store, NOW)
  const delivered = []
  const { sock } = createDemoSocket({ store, deliver: (event) => delivered.push(event), delayMs: 10 })
  await sock.sendMessage('111@s.whatsapp.net', { text: 'hello' })
  assert.equal(delivered.length, 0) // not instant
  await new Promise((resolve) => setTimeout(resolve, 60))
  assert.equal(delivered.length, 1)
  const [event] = delivered
  assert.equal(event.type, 'notify')
  const [reply] = event.messages
  assert.equal(reply.key.remoteJid, '111@s.whatsapp.net')
  assert.equal(reply.key.fromMe, false)
  assert.equal(reply.pushName, 'Alice')
  assert.equal(reply.message.conversation, DEMO_REPLIES[0])
})

test('replies cycle through the canned answers with unique ids', async () => {
  const delivered = []
  const { sock } = createDemoSocket({ store: emptyStore(), deliver: (e) => delivered.push(e.messages[0]), delayMs: 1 })
  for (let i = 0; i <= DEMO_REPLIES.length; i++) await sock.sendMessage('x', { text: String(i) })
  await new Promise((resolve) => setTimeout(resolve, 40))
  const texts = delivered.map((m) => m.message.conversation)
  assert.deepEqual(texts, [...DEMO_REPLIES, DEMO_REPLIES[0]])
  assert.equal(new Set(delivered.map((m) => m.key.id)).size, delivered.length)
})

test('imageFor returns the bytes of images sent through the demo socket', async () => {
  const { sock, imageFor } = createDemoSocket({ store: emptyStore(), deliver() {}, delayMs: 1 })
  const bytes = Buffer.from('png-bytes')
  const sent = await sock.sendMessage('x', { image: bytes })
  assert.equal(imageFor(sent.key.id), bytes)
  assert.equal(imageFor('unknown'), undefined)
})
