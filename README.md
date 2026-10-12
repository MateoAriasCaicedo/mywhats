# mywhats

Chat on WhatsApp from the terminal. It links to your account as a "linked device" (like WhatsApp Web), using [Baileys](https://github.com/WhiskeySockets/Baileys) for the connection and [blessed](https://github.com/chjj/blessed) for the interface.

> Baileys is an unofficial WhatsApp client. Use it with care: WhatsApp can restrict accounts that use unofficial clients.

## Requirements

- Node.js 20 or newer
- Optional, for voice notes: [ffmpeg](https://ffmpeg.org) on your `PATH` and a microphone (Windows only for now). Install with `winget install Gyan.FFmpeg`.

## Install

```
npm install
npm link        # makes the `mywhats` command available everywhere
```

## Run

```
mywhats         # or: npm start
mywhats --demo  # fake chats, no account and no QR code (nothing is saved)
```

The first time, scan the QR code with WhatsApp > Linked devices. The login is kept in `auth/`, so you only scan once. Message history is kept in `data/store.json`.

## Using it

Type in the box at the bottom and press Enter to send a message to the open chat. Anything starting with `/` is a command:

| Command | What it does |
| --- | --- |
| `/chats [page\|text]` | List chats, most recent first, 15 per page (`/chats 2`), or search them by name (`/chats mom`). Numbers work with `/open` |
| `/open <n\|name>` | Open a chat by number or by (part of) its name |
| `/image <path> [caption]` | Send an image. Quote paths with spaces, or drag the file into the terminal |
| `/paste [caption]` | Send the image on your clipboard (screenshot, copied picture). Ctrl+V / Alt+V does the same |
| `/view [n]` | Open the latest image of the chat in your default viewer (`n` = nth latest) |
| `/play [n]` | Listen to the latest voice note of the chat (`n` = nth latest). Uses ffplay if installed, else your default audio app |
| `/voice` | Record a voice note: Enter sends it, Esc cancels |
| `/help` | Show the commands |
| `/quit` | Exit. Typing just `exit` or pressing Ctrl-C also works (so you cannot send a message that is only "exit") |

Scroll the conversation with the mouse wheel, PageUp / PageDown, or the Up / Down arrow keys (Up / Down pick an entry instead while the `/` menu is open). An unknown command such as `/foo` shows an error instead of being sent as a message.

Images are saved to `downloads/`. `/view` only works for images received after this feature was added, because the app needs to remember how to download each one when it arrives.

### Environment variables

| Variable | Purpose |
| --- | --- |
| `WHATSAPP_MIC` | Microphone name to record from, if the first one ffmpeg finds is wrong |
| `FFMPEG_PATH` | Path to ffmpeg, if it is not on your `PATH` |

## Development

```
npm test        # unit tests (Node's built-in test runner, no extra dependencies)
npm run demo    # try the interface without an account
```

### Layout

```
index.js            controller: wires the socket, the screen and the commands together
src/
  ui.js             blessed widgets and workarounds for blessed input bugs
  format.js         pure formatting: messages, header, colours, dates
  store.js          chats and message history, saved to data/store.json
  messages.js       reading Baileys message objects
  commands.js       slash-command table, parsing and /open matching
  media.js          image arguments, file names, opening files
  recorder.js       ffmpeg microphone recording for voice notes
  demo.js           fake chats and fake socket for --demo
test/               one test file per module in src/ (except ui.js)
```

Everything in `src/` except `ui.js` has no dependency on the screen or the network and is covered by tests, using fakes for `ffmpeg` and the WhatsApp socket. `index.js` and `ui.js` need a real terminal; check them by running `npm run demo`.
