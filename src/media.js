/**
 * Helpers for sending and viewing images.
 * @module media
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFile, spawn } from 'node:child_process'

/** File extensions `/image` accepts. */
export const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif'])

const EXTENSION_BY_MIMETYPE = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'audio/ogg': 'ogg',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/aac': 'aac',
  'audio/amr': 'amr',
}

/** @param {string} file */
export const isImageFile = (file) => IMAGE_EXTENSIONS.has(path.extname(file).toLowerCase())

/**
 * File extension (no dot) for an image or audio mimetype (parameters such as
 * `; codecs=opus` are ignored); "jpg" when unknown.
 * @param {string} [mimetype]
 */
export const extensionFor = (mimetype) => EXTENSION_BY_MIMETYPE[String(mimetype).split(';')[0].trim()] || 'jpg'

/**
 * Safe file name for a downloaded image: the message id with unsafe characters
 * replaced, plus the extension for its mimetype.
 * @param {string} id Message id.
 * @param {string} [mimetype]
 */
export function downloadName(id, mimetype) {
  return `${String(id).replace(/[^A-Za-z0-9_-]/g, '_')}.${extensionFor(mimetype)}`
}

/** @param {string} file */
function isFileOnDisk(file) {
  try {
    return fs.statSync(file).isFile()
  } catch {
    return false
  }
}

/**
 * Splits the argument of `/image` into a path and a caption. The path may be quoted
 * (as when a file is dragged into the terminal) or contain spaces; unquoted, the longest
 * leading part that is an existing file wins and the rest is the caption.
 * @param {string} arg e.g. `"C:\my pics\cat.png" look at this`
 * @param {(file: string) => boolean} [isFile] Injectable for tests.
 * @returns {{file: string, caption: string}}
 */
export function parseImageArg(arg, isFile = isFileOnDisk) {
  const quote = arg[0] === '"' || arg[0] === "'" ? arg[0] : null
  if (quote) {
    const end = arg.indexOf(quote, 1)
    if (end > 0) return { file: arg.slice(1, end), caption: arg.slice(end + 1).trim() }
  }
  const words = arg.split(' ')
  for (let i = words.length; i > 0; i--) {
    const file = words.slice(0, i).join(' ')
    if (isFile(file)) return { file, caption: words.slice(i).join(' ').trim() }
  }
  return { file: words[0], caption: words.slice(1).join(' ').trim() }
}

/**
 * The command that opens a file with the system's default application.
 * @param {string} file
 * @param {NodeJS.Platform} [platform]
 * @returns {[string, string[]]} Executable and arguments.
 */
export function openCommand(file, platform = process.platform) {
  if (platform === 'win32') return ['cmd', ['/c', 'start', '', file]]
  if (platform === 'darwin') return ['open', [file]]
  return ['xdg-open', [file]]
}

/**
 * Opens a file with the default application, without waiting for it.
 * @param {string} file
 * @param {typeof spawn} [spawnImpl] Injectable for tests.
 */
export function openWithDefaultApp(file, spawnImpl = spawn) {
  const [cmd, args] = openCommand(file)
  spawnImpl(cmd, args, { detached: true, stdio: 'ignore', windowsHide: true })
    .on('error', () => {})
    .unref()
}

const WINDOWS_CLIPBOARD_SCRIPT = [
  'Add-Type -AssemblyName System.Windows.Forms',
  '$img = [System.Windows.Forms.Clipboard]::GetImage()',
  'if (-not $img) { exit 3 }',
  '$ms = New-Object System.IO.MemoryStream',
  '$img.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)',
  '[Console]::Out.Write([Convert]::ToBase64String($ms.ToArray()))',
].join('; ')

/**
 * The commands that print the clipboard image, tried in order (first one that works wins).
 * @param {NodeJS.Platform} [platform]
 * @returns {Array<{cmd: string, args: string[], base64?: boolean}>}
 */
export function clipboardImageCommands(platform = process.platform) {
  if (platform === 'win32') {
    return [{ cmd: 'powershell.exe', args: ['-NoProfile', '-STA', '-Command', WINDOWS_CLIPBOARD_SCRIPT], base64: true }]
  }
  if (platform === 'darwin') return [{ cmd: 'pngpaste', args: ['-'] }]
  return [
    { cmd: 'wl-paste', args: ['--type', 'image/png'] },
    { cmd: 'xclip', args: ['-selection', 'clipboard', '-t', 'image/png', '-o'] },
  ]
}

/**
 * Reads a PNG image from the system clipboard.
 * @param {typeof execFile} [execFileImpl] Injectable for tests.
 * @param {NodeJS.Platform} [platform]
 * @returns {Promise<Buffer>} Rejects with a user-readable Error when there is no image.
 */
export async function readClipboardImage(execFileImpl = execFile, platform = process.platform) {
  const run = ({ cmd, args }) => new Promise((resolve, reject) => {
    execFileImpl(cmd, args, { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024, windowsHide: true },
      (err, stdout) => (err ? reject(err) : resolve(stdout)))
  })
  let missingTool = false
  for (const command of clipboardImageCommands(platform)) {
    try {
      const out = await run(command)
      const bytes = command.base64 ? Buffer.from(out.toString('ascii').trim(), 'base64') : out
      if (bytes.length) return bytes
    } catch (e) {
      if (e.code === 'ENOENT') missingTool = true
    }
  }
  throw new Error(missingTool && platform !== 'win32'
    ? 'No image on the clipboard (or install wl-clipboard / xclip / pngpaste).'
    : 'No image on the clipboard.')
}

/**
 * Plays an audio file: with ffplay (ships with ffmpeg, which voice recording already
 * needs) without opening a window, else with the system's default application.
 * @param {string} file
 * @param {typeof spawn} [spawnImpl] Injectable for tests.
 */
export function playAudio(file, spawnImpl = spawn) {
  spawnImpl('ffplay', ['-nodisp', '-autoexit', '-loglevel', 'quiet', file], { stdio: 'ignore', windowsHide: true })
    .on('error', () => openWithDefaultApp(file, spawnImpl))
    .unref()
}
