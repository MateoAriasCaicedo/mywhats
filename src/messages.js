/**
 * Reading WhatsApp (Baileys) message objects.
 * @module messages
 */
import { normalizeMessageContent } from '@whiskeysockets/baileys'

/** Message content types we show as a placeholder, and the label shown for each. */
const MEDIA_LABELS = {
  imageMessage: 'image',
  videoMessage: 'video',
  audioMessage: 'voice/audio',
  documentMessage: 'document',
  stickerMessage: 'sticker',
  contactMessage: 'contact',
  locationMessage: 'location',
}

/**
 * Text to show for a message: the text itself, or `[kind] caption` for media.
 * @param {{message?: object|null}} m A Baileys message.
 * @returns {string|null} null for messages with nothing to show (reactions, protocol messages...).
 */
export function textOf(m) {
  const content = normalizeMessageContent(m.message)
  if (!content) return null
  if (content.conversation) return content.conversation
  if (content.extendedTextMessage?.text) return content.extendedTextMessage.text
  for (const [type, label] of Object.entries(MEDIA_LABELS)) {
    if (content[type]) return `[${label}]${content[type].caption ? ' ' + content[type].caption : ''}`
  }
  return null
}

/**
 * What is needed to download an image later (`downloadMediaMessage`), without the
 * inline thumbnail to keep the saved history small.
 * @param {{key: object, message?: object|null}} m A Baileys message.
 * @returns {{key: object, message: {imageMessage: object}}|undefined} undefined if it is not an image.
 */
export function imageMedia(m) {
  const image = normalizeMessageContent(m.message)?.imageMessage
  if (!image) return undefined
  return { key: m.key, message: { imageMessage: { ...image, jpegThumbnail: undefined } } }
}

/**
 * Message timestamp in Unix seconds. Baileys may give a number, a numeric string or a
 * protobuf `Long` ({low, high}); falls back to `now` when missing.
 * @param {{messageTimestamp?: unknown}} m
 * @param {number} [now] Fallback, in seconds.
 */
export function timestampOf(m, now = Math.floor(Date.now() / 1000)) {
  const ts = m.messageTimestamp
  return Number(ts?.low ?? ts) || now
}

/** @param {string} jid */
export const isGroup = (jid) => jid.endsWith('@g.us')
