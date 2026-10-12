#!/usr/bin/env node
/**
 * mywhats – chat on WhatsApp from the terminal.
 *
 * This file is the controller: it connects the WhatsApp socket (Baileys) to the screen
 * (src/ui.js) and runs the slash commands. The logic that does not need a screen or a
 * network (store, parsing, formatting, recording, demo) lives in src/ and is unit tested.
 *
 * Run with `--demo` to use fake chats without linking an account.
 */
import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  downloadMediaMessage,
} from '@whiskeysockets/baileys'
import pino from 'pino'
import qrcode from 'qrcode-terminal'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { COMMANDS, isExitWord, listChats, parseCommand, resolveChat } from './src/commands.js'
import { createDemoSocket, seedDemoStore } from './src/demo.js'
import { COLORS, colored, esc, formatMessage, headerContent } from './src/format.js'
import { downloadName, isImageFile, openWithDefaultApp, parseImageArg, playAudio, readClipboardImage } from './src/media.js'
import { findMic, startRecording } from './src/recorder.js'
import {
  addMessage as storeMessage,
  chatName,
  createSaver,
  ingestContacts,
  setLidMapping,
  loadStore,
  orderedChats,
  upsertChats,
} from './src/store.js'
import { createUi } from './src/ui.js'

const ROOT = path.dirname(fileURLToPath(import.meta.url))
const AUTH_DIR = path.join(ROOT, 'auth')
const STORE_FILE = path.join(ROOT, 'data', 'store.json')
const DOWNLOADS_DIR = path.join(ROOT, 'downloads')
const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg'

/** `--demo`: fake chats, no WhatsApp connection (no QR), nothing saved to disk. */
const DEMO = process.argv.includes('--demo')

const store = loadStore(DEMO ? null : STORE_FILE)
const saver = createSaver(store, DEMO ? null : STORE_FILE)
const { screen, header, log, input, focusInput } = createUi()

// ---------- state ----------
let order = [] // chat JIDs, most recent first (what /chats numbers refer to)
let current = null // JID of the open chat
let sock = null // Baileys socket (or the demo stand-in)
let connection = 'connecting' // 'connecting' | 'open' | 'close' | 'demo' | 'loggedOut'
let title = '' // text on the left of the header
let unreadChats = 0
let lastMessage = null // formatting state of the last message printed (see formatMessage)
/** Active voice recording: { jid, started (ms), recording, timer } */
let rec = null
/** Every ffmpeg recording not yet finished, including ones being stopped; killed on exit. */
const liveRecordings = new Set()
let imageFor = () => undefined // demo only: bytes of images sent in demo mode

const nameOf = (jid) => chatName(store, jid)
const addMessage = (jid, m, live) => storeMessage(store, jid, m, { live, current })

// ---------- rendering ----------
function renderHeader() {
  header.setContent(headerContent({
    title,
    width: screen.width,
    connection,
    unreadChats,
    recordingSeconds: rec ? (Date.now() - rec.started) / 1000 : null,
    activity: currentActivity(),
    frame: spinnerFrame,
  }))
  screen.render()
}

/** Labels of the operations in progress; the newest is shown in the header with a spinner. */
const activities = []
let spinnerFrame = 0
setInterval(() => {
  if (!currentActivity()) return
  spinnerFrame++
  renderHeader()
}, 120).unref()

function currentActivity() {
  if (activities.length) return activities[activities.length - 1]
  if (connection === 'connecting') return 'Connecting…'
  if (connection === 'close') return 'Reconnecting…'
  return null
}

/** Runs `task` while showing `label` with a spinner in the header. */
async function withActivity(label, task) {
  activities.push(label)
  renderHeader()
  try {
    return await task()
  } finally {
    activities.splice(activities.indexOf(label), 1)
    renderHeader()
  }
}
screen.on('resize', () => {
  renderHeader()
  if (current) renderChat()
})

/** Re-sorts the chats and refreshes the unread count in the header. Opens the first chat if none is open. */
function renderList() {
  order = orderedChats(store)
  unreadChats = order.filter((jid) => store.chats[jid].unread).length
  if (!current && order.length) return openChat(order[0]) // open the most recent chat by default
  renderHeader()
}

function appendMessage(m) {
  const { lines, state } = formatMessage(m, lastMessage, Date.now())
  lastMessage = state
  for (const line of lines) log.log(line)
}

function renderChat() {
  log.setContent('')
  lastMessage = null
  title = current ? nameOf(current) : ''
  if (current) for (const m of store.messages[current] || []) appendMessage(m)
  log.setScrollPerc(100)
  renderHeader()
}

/** Prints an informational line in the log. */
function status(message) {
  log.log(colored(COLORS.info, `* ${esc(message)}`))
  screen.render()
}

function openChat(jid) {
  current = jid
  if (store.chats[jid]) store.chats[jid].unread = 0
  renderList()
  renderChat()
  focusInput()
  saver.save()
}

// ---------- commands ----------
function showChats(arg) {
  renderList()
  if (!order.length) return status('No chats yet.')
  const { rows, footer } = listChats(arg, order, nameOf)
  if (rows.length) log.log('{bold}Chats:{/}')
  for (const { n, jid } of rows) {
    const unread = store.chats[jid].unread
    const badge = unread ? ` ${colored(COLORS.accent, `(${unread} new)`)}` : ''
    log.log(`  ${n}. ${esc(nameOf(jid))}${badge}`)
  }
  if (footer) log.log(colored(COLORS.muted, `  ${esc(footer)}`))
  screen.render()
}

function showHelp() {
  log.log('{bold}Commands:{/}')
  for (const { usage, description } of COMMANDS) log.log(`  ${esc(usage.padEnd(26))}${esc(description)}`)
  screen.render()
}

function openByQuery(query) {
  renderList()
  const result = resolveChat(query, order, nameOf)
  if ('error' in result) return status(result.error)
  openChat(result.jid)
}

/** Sends `content` to a chat and records it in the history. */
async function sendTo(jid, content) {
  if (!sock) return status('Not connected yet.')
  try {
    const sent = await withActivity('Sending…', async () => {
      await new Promise(setImmediate) // let the screen repaint and pending keystrokes be handled first
      return sock.sendMessage(jid, content)
    })
    if (sent) addMessage(jid, sent, false)
    renderList()
    if (current === jid) renderChat()
    saver.save()
  } catch (e) {
    status(`Send failed: ${e.message}`)
  }
}

async function sendImage(arg) {
  if (!current) return status('Open a chat first.')
  if (!arg) return status('Usage: /image <path> [caption]')
  const { file, caption } = parseImageArg(arg)
  if (!isImageFile(file)) return status(`Not an image file: ${file}`)
  let image
  try {
    image = fs.readFileSync(file)
  } catch (e) {
    return status(`Can't read ${file}: ${e.code || e.message}`)
  }
  await sendTo(current, caption ? { image, caption } : { image })
}

/** Sends the image currently on the clipboard; the argument is an optional caption. */
async function pasteImage(caption) {
  if (!current) return status('Open a chat first.')
  let image
  try {
    image = await readClipboardImage()
  } catch (e) {
    return status(e.message)
  }
  await sendTo(current, caption ? { image, caption } : { image })
}

/** Downloads (in demo mode: fabricates) an image of the open chat and opens it. */
async function viewImage(arg) {
  if (!current) return status('Open a chat first.')
  const n = arg === '' ? 1 : Number(arg)
  if (!Number.isInteger(n) || n < 1) return status('Usage: /view [n]  (n = 1 for the latest image, 2 for the one before...)')
  const images = (store.messages[current] || []).filter((m) => m.media)
  const target = images[images.length - n]
  if (!target) return status(n > 1 ? `Only ${images.length} image(s) in this chat.` : 'No images in this chat.')
  try {
    let bytes
    bytes = await withActivity('Downloading…', async () => {
      if (DEMO) return imageFor(target.id) || (await demoPlaceholderImage())
      return downloadMediaMessage(target.media, 'buffer', {}, {
        logger: pino({ level: 'silent' }),
        reuploadRequest: sock.updateMediaMessage,
      })
    })
    fs.mkdirSync(DOWNLOADS_DIR, { recursive: true })
    const file = path.join(DOWNLOADS_DIR, downloadName(target.id, target.media.message.imageMessage.mimetype))
    fs.writeFileSync(file, bytes)
    openWithDefaultApp(file)
    status(`Opened ${path.relative(ROOT, file)}`)
  } catch (e) {
    status(`Can't open this image: ${e.message}`)
  }
}

/** Downloads a voice note of the open chat and plays it. */
async function playVoice(arg) {
  if (!current) return status('Open a chat first.')
  const n = arg === '' ? 1 : Number(arg)
  if (!Number.isInteger(n) || n < 1) return status('Usage: /play [n]  (n = 1 for the latest voice note, 2 for the one before...)')
  const notes = (store.messages[current] || []).filter((m) => m.audio)
  const target = notes[notes.length - n]
  if (!target) return status(n > 1 ? `Only ${notes.length} voice note(s) in this chat.` : 'No playable voice notes in this chat.')
  if (DEMO) return status('Voice playback is not available in demo mode.')
  try {
    const bytes = await withActivity('Downloading…', () => downloadMediaMessage(target.audio, 'buffer', {}, {
      logger: pino({ level: 'silent' }),
      reuploadRequest: sock.updateMediaMessage,
    }))
    fs.mkdirSync(DOWNLOADS_DIR, { recursive: true })
    const file = path.join(DOWNLOADS_DIR, downloadName(target.id, target.audio.message.audioMessage.mimetype))
    fs.writeFileSync(file, bytes)
    playAudio(file)
    status(`Playing ${path.relative(ROOT, file)}`)
  } catch (e) {
    status(`Can't play this voice note: ${e.message}`)
  }
}

/** A plain picture for demo mode, drawn with sharp (a peer dependency of Baileys). */
async function demoPlaceholderImage() {
  const { default: sharp } = await import('sharp')
  return sharp({ create: { width: 480, height: 320, channels: 3, background: '#d4a574' } }).png().toBuffer()
}

// ---------- voice notes ----------
function endRecording() {
  if (!rec) return
  clearInterval(rec.timer)
  rec = null
  renderHeader()
}

async function startVoice() {
  if (rec) return status('Already recording. Enter sends, Esc cancels.')
  if (!current) return status('Open a chat first.')
  const r = (rec = { jid: current, started: Date.now(), recording: null, timer: null })
  renderHeader()
  if (!DEMO) {
    const mic = await findMic({ ffmpeg: FFMPEG })
    if (rec !== r) return // cancelled while looking for the microphone
    if (mic === false) {
      endRecording()
      return status('ffmpeg not found. Install it (winget install Gyan.FFmpeg) and restart.')
    }
    if (!mic) {
      endRecording()
      return status('No microphone found. Set WHATSAPP_MIC to the device name.')
    }
    liveRecordings.add(r.recording = startRecording({
      ffmpeg: FFMPEG,
      mic,
      file: path.join(os.tmpdir(), `mywhats-voice-${Date.now()}.ogg`),
    }))
    r.recording.onFailure((message) => {
      liveRecordings.delete(r.recording)
      if (rec !== r) return
      endRecording()
      status(`Recording failed: ${message}`)
    })
    r.started = Date.now()
  }
  r.timer = setInterval(renderHeader, 1000)
}

/** Ends the recording; sends it as a voice note if `send`, otherwise discards it. */
async function stopVoice(send) {
  const r = rec
  if (!r) return
  rec = null
  clearInterval(r.timer)
  renderHeader()
  const ended = Date.now() // before waiting for ffmpeg, so shutdown time is not counted
  if (!send) {
    await r.recording?.cancel()
    liveRecordings.delete(r.recording)
    return status('Recording cancelled.')
  }
  if (!r.recording && !DEMO) return status('The microphone was not ready yet, nothing was sent.')
  const audio = r.recording ? await r.recording.stop() : Buffer.from('demo')
  liveRecordings.delete(r.recording)
  if (!audio) return status('Recording failed (empty file).')
  const seconds = Math.max(1, Math.round((ended - r.started) / 1000))
  await sendTo(r.jid, { audio, ptt: true, mimetype: 'audio/ogg; codecs=opus', seconds })
}

function quit() {
  for (const recording of liveRecordings) recording.kill()
  saver.flush()
  screen.destroy()
  process.exit(0)
}

/** Command name -> handler(argument). Must cover every entry of COMMANDS. */
const handlers = {
  chats: showChats,
  open: openByQuery,
  image: sendImage,
  paste: pasteImage,
  view: viewImage,
  play: playVoice,
  voice: startVoice,
  help: showHelp,
  quit,
}
for (const { name } of COMMANDS) if (!Object.hasOwn(handlers, name)) throw new Error(`No handler for /${name}`)

// ---------- input ----------
input.on('cancel', () => {
  if (rec) stopVoice(false)
  focusInput()
})

input.on('submit', async (text) => {
  try {
    await onSubmit(text)
  } catch (e) {
    status(`Something went wrong: ${e.message}`)
  }
})

async function onSubmit(text) {
  input.clearValue()
  focusInput()
  if (rec) return stopVoice(true) // Enter while recording sends the voice note
  text = (text || '').trim()
  if (!text) return screen.render()
  if (isExitWord(text)) return quit()

  const command = parseCommand(text)
  if (command) {
    if (!Object.hasOwn(handlers, command.name)) return status(`Unknown command /${command.name}. Try /help.`)
    return handlers[command.name](command.arg)
  }
  if (!current) return status('No chat selected. Use /chats then /open <n|name>.')
  await sendTo(current, { text })
}

// Ctrl+V / Alt+V: when the clipboard holds an image, send it (text is pasted by the terminal itself)
input.key(['C-v', 'M-v'], async () => {
  const caption = input.getValue().trim()
  input.clearValue()
  try {
    await pasteImage(caption)
  } catch (e) {
    status(`Something went wrong: ${e.message}`)
  }
})

input.key(['pageup'], () => { log.scroll(-10); screen.render() })
input.key(['pagedown'], () => { log.scroll(10); screen.render() })
screen.key(['C-c'], quit)
input.key(['C-c'], quit)

// ---------- WhatsApp ----------
/**
 * Makes chats show the names from your address book: looks up the phone number behind
 * each @lid chat, and, while no address-book name is known yet, asks WhatsApp to send
 * the whole contact list again.
 */
async function syncContactNames() {
  const lidMapping = sock.signalRepository?.lidMapping
  if (lidMapping) {
    for (const jid of Object.keys(store.chats)) {
      if (!jid.endsWith('@lid') || store.lids[jid]) continue
      const pn = await lidMapping.getPNForLID(jid).catch(() => null)
      if (pn) setLidMapping(store, jid, pn.replace(/:\d+@/, '@'))
    }
    renderList()
    if (current) renderHeader()
  }
  if (!Object.keys(store.contacts).length) {
    await withActivity('Syncing contacts…', () => sock.resyncAppState(['critical_unblock_low'], true))
  }
  renderList()
  saver.save()
}

function onUpsert({ messages, type }) {
  for (const m of messages) {
    const jid = m.key.remoteJid
    if (!jid || jid === 'status@broadcast' || jid.endsWith('@newsletter')) continue
    const added = addMessage(jid, m, type === 'notify')
    if (added && jid === current) {
      const history = store.messages[jid]
      appendMessage(history[history.length - 1])
    } else if (added && type === 'notify' && !m.key.fromMe) {
      status(`New message from ${nameOf(jid)}`)
    }
  }
  renderList()
  saver.save()
}

async function connect() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR)
  const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: undefined }))
  sock = makeWASocket({
    auth: state, version, logger: pino({ level: 'silent' }),
    syncFullHistory: false, markOnlineOnConnect: false,
  })

  sock.ev.on('creds.update', saveCreds)

  sock.ev.on('connection.update', ({ connection: next, lastDisconnect, qr }) => {
    if (qr) {
      title = 'Scan with WhatsApp > Linked devices'
      renderHeader()
      qrcode.generate(qr, { small: true }, (code) => {
        // The log sticks to the bottom, which would cut off the top of the QR; show it
        // from the first line and say so if the terminal is too small to fit it whole.
        const rows = code.split('\n').length
        const fits = log.height - log.iheight >= rows
        log.setContent(fits ? code : `${code}\n{bold}Terminal too small for the QR: enlarge the window to at least ${rows + 5} rows.{/}`)
        log.scrollTo(0)
        screen.render()
      })
    }
    if (next) {
      connection = next
      renderHeader()
    }
    if (next === 'open') {
      renderChat()
      status('Connected.')
      syncContactNames().catch(() => {})
    }
    if (next === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode
      if (code === DisconnectReason.loggedOut) {
        connection = 'loggedOut'
        renderHeader()
        status('Logged out. Delete the "auth" folder and restart to link again.')
      } else {
        status('Connection lost, reconnecting...')
        setTimeout(() => connect().catch((e) => status(`Reconnect failed: ${e.message}`)), 2000)
      }
    }
  })

  sock.ev.on('lid-mapping.update', ({ lid, pn }) => { setLidMapping(store, lid, pn); renderList(); saver.save() })

  const update = (apply) => (items) => { apply(store, items); renderList(); saver.save() }
  sock.ev.on('contacts.upsert', update(ingestContacts))
  sock.ev.on('contacts.update', update(ingestContacts))
  sock.ev.on('chats.upsert', update(upsertChats))

  sock.ev.on('messaging-history.set', ({ chats, contacts, messages }) => {
    ingestContacts(store, contacts)
    upsertChats(store, chats)
    for (const m of messages) if (m.key?.remoteJid) addMessage(m.key.remoteJid, m, false)
    renderList()
    if (current) renderChat()
    saver.save()
  })

  sock.ev.on('messages.upsert', onUpsert)
}

function startDemo() {
  seedDemoStore(store)
  const demo = createDemoSocket({ store, deliver: onUpsert })
  sock = demo.sock
  imageFor = demo.imageFor
  connection = 'demo'
  renderList()
  renderChat()
  status('Demo mode: fake chats, no WhatsApp connection. Replies are simulated.')
}

renderList()
renderChat()
focusInput()
if (DEMO) startDemo()
else connect().catch((e) => status(`Fatal: ${e.message}`))
