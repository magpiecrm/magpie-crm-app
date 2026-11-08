import { useState } from 'react'
import { X } from 'lucide-react'

interface TagInputProps {
  label: string
  tags: string[]
  onChange: (tags: string[]) => void
  placeholder: string
  suggestions?: string[]
  /** At most this many; picking another replaces the last (1 makes it a single choice). */
  max?: number
  /** `field` draws it like every other form field (Field.tsx): the field border and surface, body-size text. */
  variant?: 'compact' | 'field'
}

export function TagInput({ label, tags, onChange, placeholder, suggestions = [], max, variant = 'compact' }: TagInputProps) {
  const field = variant === 'field'
  const [inputVal, setInputVal] = useState('')
  const [isFocused, setIsFocused] = useState(false)
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(0)

  const filteredSuggestions = suggestions.filter(
    (s) =>
      s.toLowerCase().includes(inputVal.toLowerCase()) &&
      !tags.includes(s)
  ).slice(0, 10)

  const addTag = (val: string) => {
    const trimmed = val.trim()
    if (trimmed && !tags.includes(trimmed)) {
      onChange(max && tags.length >= max ? [...tags.slice(0, max - 1), trimmed] : [...tags, trimmed])
    }
    setInputVal('')
    setActiveSuggestionIndex(0)
  }

  const removeTag = (indexToRemove: number) => {
    onChange(tags.filter((_, index) => index !== indexToRemove))
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      if (filteredSuggestions.length > 0 && inputVal.trim() !== '') {
        addTag(filteredSuggestions[activeSuggestionIndex])
      } else {
        addTag(inputVal)
      }
    } else if (e.key === 'Backspace' && !inputVal && tags.length > 0) {
      e.preventDefault()
      removeTag(tags.length - 1)
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (filteredSuggestions.length > 0) {
        setActiveSuggestionIndex((prev) => (prev + 1) % filteredSuggestions.length)
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (filteredSuggestions.length > 0) {
        setActiveSuggestionIndex((prev) => (prev - 1 + filteredSuggestions.length) % filteredSuggestions.length)
      }
    } else if (e.key === 'Escape') {
      setInputVal('')
    }
  }

  return (
    <div className="flex flex-col gap-1.5 w-full">
      <div className="relative">
        <div
          className={
            field
              ? `flex flex-wrap items-center gap-1 px-1 py-1 bg-card border rounded-md-s transition-colors min-h-[38px] cursor-text ${
                  isFocused ? 'ring-1 ring-accent border-accent' : 'border-input'
                }`
              : `flex flex-wrap items-center gap-1.5 p-2 bg-background border rounded-md-s transition-all min-h-[38px] cursor-text ${
                  isFocused ? 'ring-2 ring-accent border-transparent' : 'border-border'
                }`
          }
          onClick={(e) => {
            const inputEl = e.currentTarget.querySelector('input')
            if (inputEl) inputEl.focus()
          }}
        >
          {tags.map((tag, index) => (
            <span
              key={index}
              className={
                field
                  ? 'inline-flex max-w-full items-center gap-0.5 h-7 pl-2.5 pr-0.5 text-[13px] max-sm:text-sm bg-muted text-foreground rounded-md-xs border border-border'
                  : 'inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium bg-muted text-foreground rounded-full border border-border transition-all hover:bg-muted/80'
              }
            >
              {field ? <span className="truncate">{tag}</span> : tag}
              <button
                type="button"
                aria-label={`Remove ${tag}`}
                onClick={(e) => {
                  e.stopPropagation()
                  removeTag(index)
                }}
                className={
                  field
                    ? 'flex h-6 w-6 shrink-0 items-center justify-center rounded-[5px] text-muted-foreground hover:bg-muted-hover hover:text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50 transition-colors'
                    : 'text-muted-foreground hover:text-foreground outline-none transition-colors'
                }
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </span>
          ))}
          <input
            type="text"
            aria-label={label}
            className={
              field
                ? `flex-1 min-w-[60px] h-7 px-2 text-sm bg-transparent border-0 outline-none focus:ring-0 text-foreground placeholder:text-muted-foreground/90`
                : 'flex-1 min-w-[60px] text-xs bg-transparent border-0 outline-none p-0 focus:ring-0 text-foreground'
            }
            placeholder={tags.length === 0 ? placeholder : max && tags.length >= max ? 'Change…' : field ? 'Add…' : 'Add...'}
            value={inputVal}
            onChange={(e) => {
              setInputVal(e.target.value)
              setActiveSuggestionIndex(0)
            }}
            onKeyDown={handleKeyDown}
            onFocus={() => setIsFocused(true)}
            onBlur={() => {
              // Commit whatever was typed, even when suggestions exist —
              // otherwise clicking away silently discards the input. The delay
              // lets a suggestion click land first (it fires on mouseDown).
              setTimeout(() => {
                addTag(inputVal)
                setIsFocused(false)
              }, 200)
            }}
          />
        </div>

        {isFocused && inputVal.trim() !== '' && filteredSuggestions.length > 0 && (
          <div className="absolute left-0 right-0 z-50 mt-1 max-h-60 overflow-y-auto bg-card border border-border rounded-md shadow-lg py-1">
            {filteredSuggestions.map((suggestion, index) => (
              <button
                key={suggestion}
                type="button"
                className={`w-full text-left px-3 py-1.5 text-xs transition-colors cursor-pointer block ${
                  index === activeSuggestionIndex
                    ? 'bg-accent text-accent-foreground font-semibold'
                    : 'text-foreground hover:bg-muted'
                }`}
                onMouseDown={() => {
                  addTag(suggestion)
                }}
                onMouseEnter={() => setActiveSuggestionIndex(index)}
              >
                {suggestion}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
