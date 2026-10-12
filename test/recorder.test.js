import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { findMic, parseMicName, startRecording } from '../src/recorder.js'

const FFMPEG_LISTING = `[dshow @ 000001] "Microphone (Realtek Audio)" (audio)
[dshow @ 000001]   Alternative name "@device_cm_{33D9A762}"
[dshow @ 000001] "Headset (USB)" (audio)
`

test('parseMicName returns the first audio device', () => {
  assert.equal(parseMicName(FFMPEG_LISTING), 'Microphone (Realtek Audio)')
})

test('parseMicName returns null when no audio device is listed', () => {
  assert.equal(parseMicName('[dshow @ 1] "Integrated Camera" (video)'), null)
  assert.equal(parseMicName(''), null)
  assert.equal(parseMicName(undefined), null)
})

test('findMic prefers the WHATSAPP_MIC variable without running ffmpeg', async () => {
  const execFileImpl = () => assert.fail('should not run ffmpeg')
  assert.equal(await findMic({ env: { WHATSAPP_MIC: 'My Mic' }, execFileImpl }), 'My Mic')
})

test('findMic reads the device list from ffmpeg, which exits with an error', async () => {
  const execFileImpl = (_cmd, _args, callback) => callback(Object.assign(new Error('exit 1'), { code: 1 }), '', FFMPEG_LISTING)
  assert.equal(await findMic({ env: {}, execFileImpl }), 'Microphone (Realtek Audio)')
})

test('findMic returns false when ffmpeg is not installed', async () => {
  const execFileImpl = (_cmd, _args, callback) => callback(Object.assign(new Error('nope'), { code: 'ENOENT' }), '', '')
  assert.equal(await findMic({ env: {}, execFileImpl }), false)
})

test('findMic returns null when ffmpeg lists no microphone', async () => {
  const execFileImpl = (_cmd, _args, callback) => callback(new Error('exit 1'), '', 'nothing here')
  assert.equal(await findMic({ env: {}, execFileImpl }), null)
})

/**
 * A stand-in for the ffmpeg child process. On "q" it writes `audio` to the output file
 * (if given) and exits, like ffmpeg does; set `ignoreQuit` to make it hang until killed.
 */
function fakeFfmpeg({ audio, ignoreQuit = false } = {}) {
  const spawns = []
  const spawnImpl = (cmd, args) => {
    const proc = new EventEmitter()
    proc.exitCode = null
    const file = args.at(-1)
    const exit = () => { proc.exitCode = 0; proc.emit('exit', 0) }
    proc.stdin = new EventEmitter()
    proc.stdin.write = (text) => {
      if (text === 'q' && !ignoreQuit) {
        if (audio) fs.writeFileSync(file, audio)
        setImmediate(exit)
      }
    }
    proc.kill = () => setImmediate(exit)
    proc.crash = exit
    spawns.push({ cmd, args, proc })
    return proc
  }
  return { spawnImpl, spawns }
}

function tempFile(t, name = 'voice.ogg') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mywhats-test-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  return path.join(dir, name)
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

test('startRecording runs ffmpeg for the chosen microphone, to Opus in OGG', (t) => {
  const { spawnImpl, spawns } = fakeFfmpeg()
  const file = tempFile(t)
  startRecording({ mic: 'My Mic', file, ffmpeg: 'ff', spawnImpl })
  const [{ cmd, args }] = spawns
  assert.equal(cmd, 'ff')
  assert.ok(args.includes('audio=My Mic'))
  assert.ok(args.includes('libopus'))
  assert.equal(args.at(-1), file)
})

test('stop finishes ffmpeg, returns the audio and deletes the file', async (t) => {
  const { spawnImpl } = fakeFfmpeg({ audio: Buffer.from('OggS-data') })
  const file = tempFile(t)
  const recording = startRecording({ mic: 'm', file, spawnImpl })
  const audio = await recording.stop()
  assert.equal(audio.toString(), 'OggS-data')
  await wait(30)
  assert.equal(fs.existsSync(file), false)
})

test('stop returns null when nothing was recorded', async (t) => {
  const { spawnImpl } = fakeFfmpeg() // never writes the file
  const recording = startRecording({ mic: 'm', file: tempFile(t), spawnImpl })
  assert.equal(await recording.stop(), null)
})

test('cancel finishes ffmpeg and discards the audio', async (t) => {
  const { spawnImpl } = fakeFfmpeg({ audio: Buffer.from('data') })
  const file = tempFile(t)
  const recording = startRecording({ mic: 'm', file, spawnImpl })
  await recording.cancel()
  await wait(30)
  assert.equal(fs.existsSync(file), false)
})

test('stop kills ffmpeg if it does not quit in time', async (t) => {
  const { spawnImpl, spawns } = fakeFfmpeg({ ignoreQuit: true })
  const recording = startRecording({ mic: 'm', file: tempFile(t), spawnImpl, killAfterMs: 20 })
  assert.equal(await recording.stop(), null)
  assert.equal(spawns[0].proc.exitCode, 0) // it exited because it was killed
})

test('onFailure fires when ffmpeg dies by itself, but not when we stop it', async (t) => {
  const first = fakeFfmpeg()
  const crashed = startRecording({ mic: 'm', file: tempFile(t), spawnImpl: first.spawnImpl })
  const messages = []
  crashed.onFailure((message) => messages.push(message))
  first.spawns[0].proc.crash()
  assert.equal(messages.length, 1)
  assert.match(messages[0], /unexpectedly/)

  const second = fakeFfmpeg()
  const stopped = startRecording({ mic: 'm', file: tempFile(t), spawnImpl: second.spawnImpl })
  stopped.onFailure(() => assert.fail('a normal stop is not a failure'))
  await stopped.stop()
})

test('onFailure reports ffmpeg failing to start', (t) => {
  const { spawnImpl, spawns } = fakeFfmpeg()
  const recording = startRecording({ mic: 'm', file: tempFile(t), spawnImpl })
  const messages = []
  recording.onFailure((message) => messages.push(message))
  spawns[0].proc.emit('error', new Error('spawn ffmpeg ENOENT'))
  assert.deepEqual(messages, ['spawn ffmpeg ENOENT'])
})

test('kill stops ffmpeg immediately and deletes the file before returning', (t) => {
  const { spawnImpl, spawns } = fakeFfmpeg()
  const file = tempFile(t)
  fs.writeFileSync(file, 'partial')
  const recording = startRecording({ mic: 'm', file, spawnImpl })
  let killed = false
  spawns[0].proc.kill = () => { killed = true }
  recording.onFailure(() => assert.fail('kill is deliberate, not a failure'))
  recording.kill()
  assert.equal(killed, true)
  assert.equal(fs.existsSync(file), false) // synchronous: the app may exit right after
})

test('a recording that dies by itself leaves no partial file behind', async (t) => {
  const { spawnImpl, spawns } = fakeFfmpeg()
  const file = tempFile(t)
  fs.writeFileSync(file, 'partial')
  const recording = startRecording({ mic: 'm', file, spawnImpl })
  recording.onFailure(() => {})
  spawns[0].proc.crash()
  await wait(30)
  assert.equal(fs.existsSync(file), false)
})

test('a stdin error (EPIPE) while stopping is ignored instead of crashing', async (t) => {
  const { spawnImpl, spawns } = fakeFfmpeg()
  const recording = startRecording({ mic: 'm', file: tempFile(t), spawnImpl })
  const { proc } = spawns[0]
  assert.doesNotThrow(() => proc.stdin.emit('error', new Error('write EPIPE'))) // would throw with no listener
  assert.equal(await recording.stop(), null)
})
