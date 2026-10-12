/**
 * Helpers for sending and viewing images.
 * @module media
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'

/** File extensions `/image` accepts. */
export const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif'])

const EXTENSION_BY_MIMETYPE = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

/** @param {string} file */
export const isImageFile = (file) => IMAGE_EXTENSIONS.has(path.extname(file).toLowerCase())

/**
 * File extension (no dot) for an image mimetype; "jpg" when unknown.
 * @param {string} [mimetype]
 */
export const extensionFor = (mimetype) => EXTENSION_BY_MIMETYPE[mimetype] || 'jpg'

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
