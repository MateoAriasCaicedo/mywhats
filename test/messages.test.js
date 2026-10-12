import { test } from 'node:test'
import assert from 'node:assert/strict'
import { imageMedia, isGroup, textOf, timestampOf } from '../src/messages.js'

test('textOf returns plain and extended text', () => {
  assert.equal(textOf({ message: { conversation: 'hello' } }), 'hello')
  assert.equal(textOf({ message: { extendedTextMessage: { text: 'a link' } } }), 'a link')
})

test('textOf unwraps ephemeral messages', () => {
  const m = { message: { ephemeralMessage: { message: { conversation: 'vanishing' } } } }
  assert.equal(textOf(m), 'vanishing')
})

test('textOf labels media and appends the caption', () => {
  assert.equal(textOf({ message: { imageMessage: { caption: 'cat' } } }), '[image] cat')
  assert.equal(textOf({ message: { imageMessage: {} } }), '[image]')
  assert.equal(textOf({ message: { audioMessage: {} } }), '[voice/audio]')
  assert.equal(textOf({ message: { stickerMessage: {} } }), '[sticker]')
  assert.equal(textOf({ message: { locationMessage: {} } }), '[location]')
})

test('textOf returns null when there is nothing to show', () => {
  assert.equal(textOf({}), null)
  assert.equal(textOf({ message: null }), null)
  assert.equal(textOf({ message: { reactionMessage: { text: '👍' } } }), null)
  assert.equal(textOf({ message: { protocolMessage: { type: 0 } } }), null)
})

test('imageMedia keeps download info but drops the thumbnail', () => {
  const key = { id: 'A1', remoteJid: 'x@s.whatsapp.net' }
  const mediaKey = Buffer.from('secret')
  const media = imageMedia({
    key,
    message: { imageMessage: { mediaKey, url: 'https://x', jpegThumbnail: Buffer.from('thumb') } },
  })
  assert.deepEqual(media.key, key)
  assert.equal(media.message.imageMessage.mediaKey, mediaKey)
  assert.equal(media.message.imageMessage.url, 'https://x')
  assert.equal(media.message.imageMessage.jpegThumbnail, undefined)
})

test('imageMedia is undefined for non-images', () => {
  assert.equal(imageMedia({ key: {}, message: { conversation: 'hi' } }), undefined)
  assert.equal(imageMedia({ key: {} }), undefined)
})

test('timestampOf accepts numbers, strings and protobuf Longs', () => {
  assert.equal(timestampOf({ messageTimestamp: 1700000000 }), 1700000000)
  assert.equal(timestampOf({ messageTimestamp: '1700000000' }), 1700000000)
  assert.equal(timestampOf({ messageTimestamp: { low: 1700000000, high: 0 } }), 1700000000)
})

test('timestampOf falls back to now when missing or invalid', () => {
  assert.equal(timestampOf({}, 123), 123)
  assert.equal(timestampOf({ messageTimestamp: 'nope' }, 123), 123)
})

test('isGroup recognises group JIDs', () => {
  assert.equal(isGroup('123-456@g.us'), true)
  assert.equal(isGroup('123@s.whatsapp.net'), false)
})
