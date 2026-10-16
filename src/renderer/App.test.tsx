import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createComposition } from '../shared/composition'
import { App } from './App'

vi.mock('./score/ScoreView', () => ({ ScoreView: () => <div>Engraving surface</div> }))
afterEach(() => {
  delete window.notation
})

describe('score workspace', () => {
  it('creates a score, edits metadata, and advances note entry across barlines', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole('button', { name: 'New score' }))
    await user.clear(screen.getByLabelText('Title'))
    await user.type(screen.getByLabelText('Title'), 'First melody{Enter}')
    expect(document.title).toContain('First melody')
    await user.click(screen.getByRole('button', { name: 'Whole duration' }))
    await user.click(screen.getByRole('button', { name: 'Enter note' }))
    expect(screen.getByText(/4 measures/)).toHaveTextContent('1 notes')
    await user.click(screen.getByRole('button', { name: 'Enter note' }))
    expect(screen.getByText(/4 measures/)).toHaveTextContent('2 notes')
    expect(screen.getByText(/Piano · treble · Measure 3/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove last entry' })).toBeDisabled()
  })
  it('keeps the last valid tempo and protects unsaved edits', async () => {
    const user = userEvent.setup()
    render(<App />)
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Tempo' }), { target: { value: '0' } })
    fireEvent.blur(screen.getByRole('spinbutton', { name: 'Tempo' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Tempo')
    expect(screen.getByRole('spinbutton', { name: 'Tempo' })).toHaveValue(100)
    await user.click(screen.getByRole('button', { name: '+ Add measure' }))
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    await user.click(screen.getByRole('button', { name: 'New score' }))
    expect(screen.getByText(/5 measures/)).toBeInTheDocument()
  })
  it('handles save cancellation, success, failure, and validated open results', async () => {
    const user = userEvent.setup()
    const loaded = { ...createComposition(), title: 'Reopened piece' }
    const saveScore = vi
      .fn()
      .mockResolvedValueOnce({ status: 'cancelled' })
      .mockResolvedValueOnce({ status: 'error', message: 'Disk full' })
      .mockResolvedValueOnce({ status: 'ok', value: { fileName: 'piece.notation' } })
    window.notation = {
      saveScore,
      setDocumentDirty: vi.fn(),
      openScore: vi
        .fn()
        .mockResolvedValue({ status: 'ok', value: { score: loaded, fileName: 'loaded.notation' } }),
    }
    render(<App />)
    await user.click(screen.getByRole('button', { name: '+ Add measure' }))
    await user.click(screen.getByRole('button', { name: 'Save score' }))
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Save score' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Disk full')
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Save score' }))
    await waitFor(() => expect(screen.getByText('piece.notation')).toBeInTheDocument())
    expect(window.notation.setDocumentDirty).toHaveBeenLastCalledWith(false)
    await user.click(screen.getByRole('button', { name: 'Open' }))
    expect(screen.getByLabelText('Title')).toHaveValue('Reopened piece')
    expect(screen.getByText('loaded.notation')).toBeInTheDocument()
  })
  it('disables native file actions in the browser harness', () => {
    render(<App />)
    expect(screen.getByRole('button', { name: 'Open' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Save score' })).toBeDisabled()
  })
  it('undoes document edits, updates metadata controls, and preserves native text-field undo', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole('button', { name: 'New score' }))
    await user.click(screen.getByRole('button', { name: '+ Add measure' }))
    await user.click(screen.getByRole('button', { name: 'Undo' }))
    expect(screen.getByText(/4 measures/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Redo' }))
    expect(screen.getByText(/5 measures/)).toBeInTheDocument()
    await user.clear(screen.getByLabelText('Title'))
    await user.type(screen.getByLabelText('Title'), 'Edited title{Enter}')
    expect(screen.getByLabelText('Title')).toHaveValue('Edited title')
    await user.click(screen.getByRole('button', { name: 'Undo' }))
    expect(screen.getByLabelText('Title')).toHaveValue('Untitled composition')
    await user.click(screen.getByLabelText('Title'))
    await user.keyboard('{Control>}z{/Control}')
    expect(screen.getByText(/5 measures/)).toBeInTheDocument()
  })
  it('disables signature edits during a pending save and tracks the saved document through undo/redo', async () => {
    const user = userEvent.setup()
    let finish!: () => void
    window.notation = {
      openScore: vi.fn(),
      setDocumentDirty: vi.fn(),
      saveScore: vi.fn().mockImplementation(
        () =>
          new Promise((resolve) => {
            finish = () => resolve({ status: 'ok', value: { fileName: 'saved.notation' } })
          }),
      ),
    }
    render(<App />)
    await user.click(screen.getByRole('button', { name: '+ Add measure' }))
    await user.click(screen.getByRole('button', { name: 'Save score' }))
    expect(screen.getByLabelText('Key signature')).toBeDisabled()
    expect(screen.getByLabelText('Time signature')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Apply signatures' })).toBeDisabled()
    finish()
    await waitFor(() => expect(screen.getByText('saved.notation')).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: 'Undo' }))
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Redo' }))
    expect(screen.getByText('saved.notation')).toBeInTheDocument()
    expect(window.notation.setDocumentDirty).toHaveBeenLastCalledWith(false)
  })
})
