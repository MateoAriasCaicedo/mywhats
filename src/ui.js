/**
 * The terminal widgets (blessed): a header line, the message log and a bordered
 * prompt box, plus workarounds for a few blessed text-input bugs.
 * @module ui
 */
import blessed from 'blessed'

/**
 * Builds the screen and its widgets. Layout (top to bottom): header, blank line,
 * log (fills the rest), 3-line prompt box.
 * @returns {{
 *   screen: import('blessed').Widgets.Screen,
 *   header: import('blessed').Widgets.BoxElement,
 *   log: import('blessed').Widgets.Log,
 *   input: import('blessed').Widgets.TextboxElement,
 *   focusInput: () => void,
 * }}
 */
export function createUi() {
  const screen = blessed.screen({ smartCSR: true, title: 'mywhats', fullUnicode: true })

  const header = blessed.box({
    parent: screen, top: 0, left: 0, right: 0, height: 1, tags: true, padding: { left: 1, right: 1 },
  })
  const log = blessed.log({
    parent: screen, top: 2, left: 0, right: 0, bottom: 3, padding: { left: 1, right: 1 },
    tags: true, scrollable: true, alwaysScroll: true, mouse: true,
  })
  // Prompt box in the style of Claude Code: bordered, gray, with a "> " prompt.
  const box = blessed.box({
    parent: screen, bottom: 0, left: 0, right: 0, height: 3,
    border: 'line', style: { border: { fg: 'gray' } },
  })
  blessed.box({ parent: box, top: 0, left: 1, width: 1, height: 1, tags: true, content: '>' })
  const input = blessed.textbox({
    parent: box, top: 0, left: 3, right: 1, height: 1,
    inputOnFocus: true, keys: true, mouse: true,
  })

  // blessed can leak a duplicate keypress listener on the textbox when focus changes
  // right after a read starts, which makes every typed character repeat. All the
  // duplicates receive the same key object for one keypress, so handle each only once.
  const baseListener = input._listener
  let lastKey
  input._listener = function (ch, key) {
    if (key && key === lastKey) return
    lastKey = key
    return baseListener.call(this, ch, key)
  }

  // blessed moves the cursor with relative moves from a tracked position, which drifts
  // after redraws (visible when deleting characters). Place it absolutely instead, and
  // re-place it after every render because drawing the screen moves it.
  input._updateCursor = function () {
    if (screen.focused !== this) return
    const lpos = this._getCoords()
    if (!lpos) return
    const line = this.value.split('\n').pop()
    screen.program.cup(lpos.yi + this.itop, lpos.xi + this.ileft + this.strWidth(line))
  }
  screen.on('render', () => input._updateCursor())

  // With inputOnFocus, focusing an input that is already reading makes blessed blur and
  // refocus it recursively until the stack overflows, so only focus when it is idle.
  const focusInput = () => {
    if (!input._reading) input.focus()
  }

  return { screen, header, log, input, focusInput }
}
