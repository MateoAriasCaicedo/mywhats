/**
 * Voice-note recording with ffmpeg: the microphone is captured (DirectShow, so Windows)
 * straight to Opus/OGG, the format WhatsApp uses for voice notes.
 * @module recorder
 */
import fs from 'node:fs'
import { execFile, spawn } from 'node:child_process'

/**
 * Picks the first audio device out of ffmpeg's `-list_devices` output.
 * @param {string} [stderr]
 * @returns {string|null}
 */
export function parseMicName(stderr) {
  return /"([^"]+)"\s+\(audio\)/.exec(stderr || '')?.[1] ?? null
}

/**
 * Finds the microphone to record from: `WHATSAPP_MIC` if set, else the first one ffmpeg lists.
 * @param {object} [options]
 * @param {NodeJS.ProcessEnv} [options.env]
 * @param {string} [options.ffmpeg] ffmpeg executable.
 * @param {typeof execFile} [options.execFileImpl] Injectable for tests.
 * @returns {Promise<string|null|false>} Device name, `null` if none was found, `false` if ffmpeg is not installed.
 */
export function findMic({ env = process.env, ffmpeg = 'ffmpeg', execFileImpl = execFile } = {}) {
  if (env.WHATSAPP_MIC) return Promise.resolve(env.WHATSAPP_MIC)
  return new Promise((resolve) => {
    // ffmpeg always exits with an error here (there is no real input); only stderr matters.
    execFileImpl(ffmpeg, ['-hide_banner', '-list_devices', 'true', '-f', 'dshow', '-i', 'dummy'], (err, _out, stderr) => {
      if (err?.code === 'ENOENT') return resolve(false)
      resolve(parseMicName(stderr))
    })
  })
}

/**
 * @typedef {object} Recording
 * @property {string} file Output file.
 * @property {(callback: (message: string) => void) => void} onFailure Called if ffmpeg dies by itself.
 * @property {() => Promise<Buffer|null>} stop Ends the recording and returns the audio (null if unreadable/empty).
 * @property {() => Promise<void>} cancel Ends the recording and discards it.
 * @property {() => void} kill Stops ffmpeg immediately and deletes the file synchronously (for exiting the app).
 */

/**
 * Starts recording the microphone to `file`.
 * @param {object} options
 * @param {string} options.mic Device name from {@link findMic}.
 * @param {string} options.file Output `.ogg` path.
 * @param {string} [options.ffmpeg]
 * @param {typeof spawn} [options.spawnImpl] Injectable for tests.
 * @param {number} [options.killAfterMs] How long to wait for ffmpeg to finish before killing it.
 * @returns {Recording}
 */
export function startRecording({ mic, file, ffmpeg = 'ffmpeg', spawnImpl = spawn, killAfterMs = 3000 }) {
  const proc = spawnImpl(ffmpeg, [
    '-y', '-f', 'dshow', '-i', `audio=${mic}`,
    '-c:a', 'libopus', '-b:a', '32k', '-ar', '48000', '-ac', '1', file,
  ], { stdio: ['pipe', 'ignore', 'ignore'] })

  let finishing = false // set once we ask ffmpeg to stop, so its exit is not a failure
  let dead = false
  let onFailure = () => {}
  const discard = () => fs.rm(file, { force: true }, () => {})
  // Writing "q" to a process that just died raises EPIPE on stdin; that is not an error here.
  proc.stdin?.on?.('error', () => {})
  proc.on('error', (e) => {
    dead = true
    if (finishing) return
    discard()
    onFailure(e.message)
  })
  proc.on('exit', () => {
    dead = true
    if (finishing) return
    discard() // drop the partial recording
    onFailure('ffmpeg stopped unexpectedly (check the microphone)')
  })

  // Sending "q" makes ffmpeg finish and close the file properly; kill it if it hangs.
  const finish = () => new Promise((resolve) => {
    finishing = true
    if (dead) return resolve()
    const killer = setTimeout(() => proc.kill(), killAfterMs)
    proc.once('exit', () => { clearTimeout(killer); resolve() })
    proc.once('error', () => { clearTimeout(killer); resolve() })
    try { proc.stdin.write('q') } catch {}
  })

  return {
    file,
    onFailure: (callback) => { onFailure = callback },
    async stop() {
      await finish()
      let audio = null
      try { audio = fs.readFileSync(file) } catch {}
      discard()
      return audio?.length ? audio : null
    },
    async cancel() {
      await finish()
      discard()
    },
    kill() {
      finishing = true
      try { proc.kill() } catch {}
      fs.rmSync(file, { force: true }) // synchronous: the app may exit right after this
    },
  }
}
