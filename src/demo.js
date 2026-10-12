/**
 * Demo mode: fake chats and a fake WhatsApp socket, so the app can be tried (and
 * screenshotted) without linking an account or scanning a QR code.
 * @module demo
 */
import { addMessage, chatName } from './store.js'

/** Chats created by the demo: [jid, name, [[secondsAgo, fromMe, text, isImage?], ...]]. */
export const DEMO_CHATS = [
  ['111@s.whatsapp.net', 'Alice', [
    [3600, false, 'Hey! Are we still on for lunch?'],
    [3500, true, 'Yes, 1pm works for me'],
    [3400, false, 'Perfect, see you there'],
    [3300, false, 'Menu for today', true],
  ]],
  ['222@s.whatsapp.net', 'Bob', [[7200, false, 'Did you see the game last night?']]],
  ['333@g.us', 'Project Team', [
    [900, false, 'Standup in 5 minutes'],
    [600, false, 'Reminder: demo is today'],
  ]],
]

/** Replies the fake contacts cycle through. */
export const DEMO_REPLIES = ['Sounds good!', 'Haha nice', 'Let me check and get back to you', 'Got it 👍']

/**
 * Fills the store with the demo chats.
 * @param {import('./store.js').Store} store
 * @param {number} [now] Current time in seconds.
 */
export function seedDemoStore(store, now = Math.floor(Date.now() / 1000)) {
  for (const [jid, name, messages] of DEMO_CHATS) {
    store.chats[jid] = { name, last: 0, unread: 0 }
    messages.forEach(([ago, fromMe, text, isImage], i) => {
      addMessage(store, jid, {
        key: { id: `${jid}-${i}`, fromMe, remoteJid: jid },
        pushName: name,
        messageTimestamp: now - ago,
        message: isImage
          ? { imageMessage: { caption: text, mimetype: 'image/png' } }
          : { conversation: text },
      })
    })
  }
}

/**
 * A stand-in for the Baileys socket: `sendMessage` returns the sent message and, after a
 * delay, delivers a canned reply as if the other person had answered.
 * @param {object} options
 * @param {import('./store.js').Store} options.store Used to name the replying chat.
 * @param {(event: {type: string, messages: object[]}) => void} options.deliver Receives incoming messages
 *   (same shape as Baileys' `messages.upsert`).
 * @param {number} [options.delayMs] Delay before the reply.
 * @returns {{sock: {sendMessage: Function}, imageFor: (id: string) => Buffer|undefined}}
 *   `imageFor` returns the bytes of an image sent through this socket, by message id.
 */
export function createDemoSocket({ store, deliver, delayMs = 1200 }) {
  const images = new Map()
  let sentCount = 0
  let replyCount = 0

  const sock = {
    async sendMessage(jid, content) {
      const ts = Math.floor(Date.now() / 1000)
      const id = `demo-sent-${++sentCount}`
      if (content.image) images.set(id, content.image)

      const replyId = `demo-reply-${++replyCount}`
      const reply = DEMO_REPLIES[(replyCount - 1) % DEMO_REPLIES.length]
      setTimeout(() => deliver({
        type: 'notify',
        messages: [{
          key: { id: replyId, fromMe: false, remoteJid: jid },
          pushName: chatName(store, jid),
          messageTimestamp: Math.floor(Date.now() / 1000),
          message: { conversation: reply },
        }],
      }), delayMs)

      return {
        key: { id, fromMe: true, remoteJid: jid },
        messageTimestamp: ts,
        message: content.audio ? { audioMessage: {} }
          : content.image ? { imageMessage: { caption: content.caption, mimetype: 'image/png' } }
          : { conversation: content.text },
      }
    },
  }

  return { sock, imageFor: (id) => images.get(id) }
}
