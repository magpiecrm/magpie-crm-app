import { coerceCustomValue, type ContactFieldDef, type ContactFieldType } from './contactFields'
import { exportHeader } from './exportColumns'

// Reading an import into a grid of cells, and working out which column is which.

// Helper to detect CSV delimiter
export function detectDelimiter(text: string): string {
  const lines = text.split('\n').slice(0, 5).filter(Boolean)
  const counts = { ',': 0, ';': 0, '\t': 0 }
  for (const line of lines) {
    counts[','] += (line.match(/,/g) || []).length
    counts[';'] += (line.match(/;/g) || []).length
    counts['\t'] += (line.match(/\t/g) || []).length
  }
  if (counts[';'] > counts[','] && counts[';'] > counts['\t']) return ';'
  if (counts['\t'] > counts[','] && counts['\t'] > counts[';']) return '\t'
  return ','
}

// Robust CSV/text parser supporting quotes and empty cells
export function parseCSV(text: string, delimiter: string): string[][] {
  const grid: string[][] = []
  let row: string[] = []
  let currentValue = ''
  let inQuotes = false

  const pushRow = () => {
    row.push(currentValue.trim())
    currentValue = ''
    // Skip blank lines, but keep rows where only some cells are empty.
    if (row.some(cell => cell !== '')) grid.push(row)
    row = []
  }

  // Scanned over the whole text rather than line-by-line so that quoted fields
  // may themselves contain the delimiter or a newline.
  for (let i = 0; i < text.length; i++) {
    const char = text[i]

    if (inQuotes) {
      if (char !== '"') {
        currentValue += char
      } else if (text[i + 1] === '"') {
        currentValue += '"' // "" inside a quoted field is a literal quote
        i++
      } else {
        inQuotes = false
      }
      continue
    }

    if (char === '"') {
      inQuotes = true
    } else if (char === delimiter) {
      row.push(currentValue.trim())
      currentValue = ''
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i++
      pushRow()
    } else {
      currentValue += char
    }
  }
  pushRow()

  return grid
}

const SPREADSHEET_EXTENSIONS = ['.xlsx', '.xlsm', '.xlsb', '.xls', '.ods']

export function isSpreadsheetFile(file: File): boolean {
  const name = file.name.toLowerCase()
  return SPREADSHEET_EXTENSIONS.some(ext => name.endsWith(ext))
}

// Read the first sheet of an Excel/ODS workbook into the same string grid
// shape the CSV parser produces
export async function parseSpreadsheet(file: File): Promise<string[][]> {
  const { read, utils, SSF } = await import('xlsx')
  const workbook = read(await file.arrayBuffer(), { type: 'array', cellNF: true })
  const sheetName = workbook.SheetNames[0]
  if (!sheetName) return []

  const sheet = workbook.Sheets[sheetName]
  // A date is a number with a date format, shown as the file shows it (3/31/26): give it the one form a date field takes.
  for (const cell of Object.values(sheet) as any[]) {
    if (cell?.t === 'n' && cell.z && SSF.is_date(cell.z)) cell.w = SSF.format('yyyy-mm-dd', cell.v)
  }

  const rows = utils.sheet_to_json<any[]>(sheet, {
    header: 1,
    blankrows: false,
    raw: false, // let SheetJS format dates/numbers as display strings
    defval: '',
  })

  return rows
    .map(row => row.map(cell => (cell == null ? '' : String(cell).trim())))
    .filter(row => row.some(cell => cell !== ''))
}

const normalise = (header: string) => header.replace(/^﻿/, '').trim().toLowerCase().replace(/[\s_-]+/g, ' ')

/** Whole headers, so "Last purchase" isn't a last name and "Company size" isn't a company. */
const BUILTIN_HEADERS: Record<string, string> = Object.fromEntries(
  Object.entries({
    email: ['email', 'e mail', 'email address', 'e mail address', 'mail', 'work email', 'addr'],
    firstName: ['first name', 'firstname', 'first', 'fname', 'given name', 'name'],
    lastName: ['last name', 'lastname', 'last', 'lname', 'surname', 'family name'],
    company: ['company', 'company name', 'organisation', 'organization', 'organisation name', 'organization name', 'org', 'business', 'business name', 'employer'],
    jobTitle: ['job title', 'title', 'role', 'job role', 'job', 'position'],
    country: ['country'],
  }).flatMap(([target, headers]) => headers.map(h => [h, target])),
)

const customTargets = (fields: ContactFieldDef[]) => {
  const targets = new Map<string, string>()
  for (const f of fields) {
    targets.set(normalise(f.key), `custom:${f.key}`)
    targets.set(normalise(exportHeader(f, fields)), `custom:${f.key}`)
  }
  return targets
}

// Auto detect fields from columns
export function autoDetectMappings(grid: string[][], hasHeaders: boolean, fields: ContactFieldDef[] = []): Record<number, string> {
  const mappings: Record<number, string> = {}
  if (grid.length === 0) return mappings

  const numCols = Math.max(...grid.map(row => row.length))

  // 1. Try to match headers if present: a custom field by its exact name, a
  // built-in by the names it goes by, and only then any header mentioning email.
  if (hasHeaders) {
    const custom = customTargets(fields)
    const taken = new Set<string>()
    grid[0].forEach((cell, colIdx) => {
      const header = normalise(cell || '')
      const target = custom.get(header) ?? BUILTIN_HEADERS[header] ?? (/\b(e ?mail)\b/.test(header) ? 'email' : undefined)
      // The first of two columns with one name; the other stays skipped.
      if (target && !taken.has(target)) {
        taken.add(target)
        mappings[colIdx] = target
      }
    })
  }

  // 2. Scan first few data rows to locate the column containing email if not found
  const hasEmailMap = Object.values(mappings).includes('email')
  if (!hasEmailMap) {
    const startRow = hasHeaders ? 1 : 0
    const colScore: Record<number, number> = {}
    const sampleRows = grid.slice(startRow, startRow + 5)
    for (const row of sampleRows) {
      for (let colIdx = 0; colIdx < row.length; colIdx++) {
        const val = row[colIdx]
        if (val && val.includes('@') && val.includes('.')) {
          colScore[colIdx] = (colScore[colIdx] || 0) + 1
        }
      }
    }
    let bestCol = -1
    let maxScore = 0
    for (const colIdxStr in colScore) {
      const colIdx = Number(colIdxStr)
      if (colScore[colIdx] > maxScore) {
        maxScore = colScore[colIdx]
        bestCol = colIdx
      }
    }
    if (bestCol !== -1) {
      mappings[bestCol] = 'email'
    }
  }

  // 3. Fill remaining columns with 'skip'
  for (let colIdx = 0; colIdx < numCols; colIdx++) {
    if (!mappings[colIdx]) {
      mappings[colIdx] = 'skip'
    }
  }

  return mappings
}

/** A cell as a custom value, without the quote a CSV export puts before anything a spreadsheet could read as a formula. */
export const cleanCustomCell = (cell: string) => cell.replace(/^'(?=[=+\-@])/, '')

const provisional = (type: ContactFieldType): ContactFieldDef => ({ key: 'field', label: 'Field', type, created_at: '' })

/** The most likely type for a column, from what's in it. */
export function inferFieldType(samples: string[]): { type: ContactFieldType; options?: string[] } {
  const cells = samples.map(s => cleanCustomCell(s).trim()).filter(Boolean)
  if (cells.length === 0) return { type: 'text' }
  for (const type of ['number', 'date', 'boolean'] as const) {
    if (cells.every(cell => coerceCustomValue(cell, provisional(type)).ok)) return { type }
  }
  const distinct = [...new Map([...cells].reverse().map(cell => [cell.toLowerCase(), cell])).values()].reverse()
  // A few values repeated, none needing a comma, reads as a choice.
  if (distinct.length <= 10 && cells.length >= distinct.length * 2 && !distinct.some(d => d.includes(',') || d.length > 80)) return { type: 'select', options: distinct }
  return { type: 'text' }
}

const dataRows = (grid: string[][], hasHeaders: boolean) => (hasHeaders ? grid.slice(1) : grid)

/** What to start a new field with for a column. */
export function guessField(grid: string[][], hasHeaders: boolean, column: number) {
  return { label: hasHeaders ? (grid[0]?.[column] ?? '').replace(/^﻿/, '').trim().slice(0, 80) : '', ...inferFieldType(dataRows(grid, hasHeaders).map(row => row[column] ?? '')) }
}

/** The cells that won't fit the fields they're mapped to, field by field, so they can be seen before importing. */
export function importProblems(grid: string[][], hasHeaders: boolean, mappings: Record<number, string>, fields: ContactFieldDef[]) {
  const found: Array<{ label: string; count: number; example: string; problem: string }> = []
  const rows = dataRows(grid, hasHeaders)
  for (const [column, target] of Object.entries(mappings)) {
    const field = target.startsWith('custom:') ? fields.find(f => `custom:${f.key}` === target) : undefined
    if (!field) continue
    const bad = rows.map(row => cleanCustomCell(row[Number(column)] ?? '')).flatMap(cell => {
      const coerced = coerceCustomValue(cell, field)
      return coerced.ok ? [] : [{ cell, problem: coerced.problem }]
    })
    if (bad.length) found.push({ label: field.label, count: bad.length, example: bad[0].cell.slice(0, 40), problem: bad[0].problem })
  }
  return found
}
