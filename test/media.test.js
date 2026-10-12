import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  downloadName, extensionFor, isImageFile, openCommand, openWithDefaultApp, parseImageArg,
} from '../src/media.js'

test('isImageFile accepts common image extensions in any case', () => {
  for (const f of ['a.png', 'a.JPG', 'a.jpeg', 'a.webp', 'a.gif', 'C:\\pics\\a.PNG']) assert.ok(isImageFile(f), f)
  for (const f of ['a.txt', 'a', 'a.png.exe', 'a.pdf']) assert.ok(!isImageFile(f), f)
})

test('extensionFor maps mimetypes and defaults to jpg', () => {
  assert.equal(extensionFor('image/png'), 'png')
  assert.equal(extensionFor('image/webp'), 'webp')
  assert.equal(extensionFor('image/jpeg'), 'jpg')
  assert.equal(extensionFor('image/unknown'), 'jpg')
  assert.equal(extensionFor(undefined), 'jpg')
})

test('downloadName makes a safe file name from the message id', () => {
  assert.equal(downloadName('111@s.whatsapp.net-3', 'image/png'), '111_s_whatsapp_net-3.png')
  assert.equal(downloadName('../../evil', 'image/jpeg'), '______evil.jpg')
})

test('parseImageArg handles double and single quoted paths', () => {
  assert.deepEqual(parseImageArg('"C:\\my pics\\cat.png" nice cat', () => false), {
    file: 'C:\\my pics\\cat.png', caption: 'nice cat',
  })
  assert.deepEqual(parseImageArg("'/tmp/a b.png'", () => false), { file: '/tmp/a b.png', caption: '' })
})

test('parseImageArg picks the longest leading part that is a file', () => {
  const isFile = (f) => f === 'my pics/cat.png'
  assert.deepEqual(parseImageArg('my pics/cat.png look at this', isFile), {
    file: 'my pics/cat.png', caption: 'look at this',
  })
})

test('parseImageArg falls back to the first word when nothing exists', () => {
  assert.deepEqual(parseImageArg('missing.png a caption', () => false), {
    file: 'missing.png', caption: 'a caption',
  })
  assert.deepEqual(parseImageArg('"unterminated.png', () => false), { file: '"unterminated.png', caption: '' })
})

test('parseImageArg checks the real file system by default', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mywhats-test-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const file = path.join(dir, 'with space.png')
  fs.writeFileSync(file, 'x')
  assert.deepEqual(parseImageArg(`${file} hello`), { file, caption: 'hello' })
  assert.deepEqual(parseImageArg(dir), { file: dir, caption: '' }) // a directory is not a file
})

test('openCommand picks the right opener per platform', () => {
  assert.deepEqual(openCommand('a.png', 'win32'), ['cmd', ['/c', 'start', '', 'a.png']])
  assert.deepEqual(openCommand('a.png', 'darwin'), ['open', ['a.png']])
  assert.deepEqual(openCommand('a.png', 'linux'), ['xdg-open', ['a.png']])
})

test('openWithDefaultApp starts the opener detached and does not wait for it', () => {
  const calls = []
  let unreffed = false
  const fakeChild = { on() { return this }, unref() { unreffed = true } }
  openWithDefaultApp('a.png', (cmd, args, options) => {
    calls.push({ cmd, args, options })
    return fakeChild
  })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].args.at(-1), 'a.png')
  assert.equal(calls[0].options.detached, true)
  assert.equal(unreffed, true)
})
