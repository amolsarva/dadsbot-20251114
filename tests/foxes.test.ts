import { describe, expect, it } from 'vitest'
import { clearFoxes, flagFox, listFoxes } from '../lib/foxes'

describe('foxes', () => {
  it('records and deduplicates fox events', () => {
    clearFoxes()
    flagFox({ id: 'test-fox', theory: 1, level: 'warn', message: 'First hit' })
    flagFox({ id: 'test-fox', theory: 1, level: 'error', message: 'Escalated', details: { reason: 'boom' } })
    const foxes = listFoxes()
    expect(foxes).toHaveLength(1)
    expect(foxes[0].level).toBe('error')
    expect(foxes[0].count).toBe(2)
    expect(foxes[0].details).toEqual({ reason: 'boom' })
    expect(foxes[0].message).toBe('Escalated')
  })

  it('sorts foxes by last triggered timestamp', () => {
    clearFoxes()
    flagFox({ id: 'first', theory: 2, level: 'warn', message: 'First' })
    flagFox({ id: 'second', theory: 3, level: 'info', message: 'Second' })
    flagFox({ id: 'first', theory: 2, level: 'warn', message: 'First again' })
    const foxes = listFoxes()
    expect(foxes[0].id).toBe('first')
    expect(foxes[0].count).toBe(2)
    expect(foxes[1].id).toBe('second')
  })
})
