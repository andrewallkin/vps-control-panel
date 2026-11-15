import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { Tabs, TabsContent, TabsList, TabsTrigger } from './Tabs'

function ControlledTabs({ onValueChange }: { onValueChange?: (value: string) => void }) {
  const [value, setValue] = useState('a')
  return (
    <Tabs
      value={value}
      onValueChange={(next) => {
        setValue(next)
        onValueChange?.(next)
      }}
    >
      <TabsList>
        <TabsTrigger value="a">Tab A</TabsTrigger>
        <TabsTrigger value="b">Tab B</TabsTrigger>
      </TabsList>
      <TabsContent value="a">Panel A</TabsContent>
      <TabsContent value="b">Panel B</TabsContent>
    </Tabs>
  )
}

describe('Tabs', () => {
  it('calls onValueChange when selection changes', async () => {
    const user = userEvent.setup()
    const onValueChange = vi.fn()
    render(<ControlledTabs onValueChange={onValueChange} />)
    expect(screen.getByText('Panel A')).toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: 'Tab B' }))
    expect(onValueChange).toHaveBeenCalledWith('b')
    expect(screen.getByText('Panel B')).toBeInTheDocument()
  })

  it('supports arrow-key navigation between tabs', async () => {
    const user = userEvent.setup()
    render(<ControlledTabs />)
    const tabA = screen.getByRole('tab', { name: 'Tab A' })
    tabA.focus()
    await user.keyboard('{ArrowRight}')
    expect(screen.getByRole('tab', { name: 'Tab B' })).toHaveFocus()
  })
})