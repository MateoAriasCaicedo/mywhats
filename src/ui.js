/**
 * The terminal widgets (blessed): a header line, the message log and a bordered
 * prompt between two rules, plus workarounds for a few blessed text-input bugs.
 * @module ui
 */
import blessed from 'blessed'
import { suggestCommands } from './commands.js'
import { COLORS } from './format.js'

/**
 * Builds the screen and its widgets. Layout (top to bottom): header, blank line,
 * log (fills the rest), 3-line prompt (rule, input, rule).
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
  // Prompt in the style of Claude Code: a "> " line between two gray horizontal rules.
  const box = blessed.box({ parent: screen, bottom: 0, left: 0, right: 0, height: 3 })
  const rules = [0, 2].map((top) => blessed.box({ parent: box, top, left: 0, right: 0, height: 1, style: { fg: 'gray' } }))
  const drawRules = () => rules.forEach((rule) => rule.setContent('─'.repeat(screen.width)))
  drawRules()
  screen.on('resize', drawRules)
  blessed.box({ parent: box, top: 1, left: 1, width: 1, height: 1, tags: true, content: '>' })
  const input = blessed.textbox({
    parent: box, top: 1, left: 3, right: 1, height: 1,
    inputOnFocus: true, keys: true, mouse: true,
  })

  // Slash-command menu above the prompt: filters as you type, Up/Down select, Tab completes.
  const menu = blessed.list({
    parent: screen, bottom: 3, left: 0, right: 0, height: 1, hidden: true,
    style: { item: { fg: 'gray' }, selected: { fg: COLORS.accent, bold: true } },
  })
  let suggestions = []
  const updateMenu = () => {
    suggestions = suggestCommands(input.value)
    if (!suggestions.length) {
      if (!menu.hidden) { menu.hide(); screen.render() }
      return
    }
    const width = Math.max(...suggestions.map((c) => c.usage.length)) + 2
    const previous = menu.selected || 0
    menu.setItems(suggestions.map((c) => `  ${c.usage.padEnd(width)}${c.description}`))
    menu.height = suggestions.length
    menu.select(Math.min(previous, suggestions.length - 1))
    menu.show()
    screen.render()
  }
  const complete = () => {
    const { name } = suggestions[menu.selected]
    input.setValue(`/${name} `)
    updateMenu()
  }

  // blessed can leak a duplicate keypress listener on the textbox when focus changes
  // right after a read starts, which makes every typed character repeat. All the
  // duplicates receive the same key object for one keypress, so handle each only once.
  const baseListener = input._listener
  let lastKey
  input._listener = function (ch, key) {
    if (key && key === lastKey) return
    lastKey = key
    if (suggestions.length && key) {
      if (key.name === 'up' || key.name === 'down') {
        const n = suggestions.length
        menu.select((menu.selected + (key.name === 'down' ? 1 : n - 1)) % n)
        return screen.render()
      }
      if (key.name === 'tab') return complete()
      // Enter on a partial command completes it; on a full command name it sends.
      if (key.name === 'enter' && suggestions[menu.selected].name !== this.value.slice(1).toLowerCase()) return complete()
    }
    const result = baseListener.call(this, ch, key)
    updateMenu()
    return result
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

  // Submitting or cancelling clears the box without a keypress, so close the menu then too.
  input.on('submit', updateMenu)
  input.on('cancel', updateMenu)

  return { screen, header, log, input, focusInput }
}
