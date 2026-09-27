/**
 * Shared CSV / XLSX export helpers.
 *
 * Callers describe their data as a list of columns (header + accessor) and get
 * back a browser download. Keeping the column description in one place means a
 * CSV and an XLSX export of the same table can never drift apart.
 */

export interface ExportColumn<T> {
  header: string
  value: (row: T) => string | number | boolean | null | undefined
}

/** Normalise an accessor result to the string we actually write out. */
function toCell(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return ''
  return String(value)
}

/**
 * Spreadsheet apps treat a leading =, +, -, @ (or a leading tab/CR) as the
 * start of a formula. Contact data is user-supplied and often imported from
 * elsewhere, so prefix those cells with a quote to keep them inert.
 */
function neutralizeFormula(cell: string): string {
  return /^[=+\-@\t\r]/.test(cell) ? `'${cell}` : cell
}

function escapeCsvCell(cell: string): string {
  const safe = neutralizeFormula(cell)
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

function buildCsv<T>(rows: T[], columns: ExportColumn<T>[]): string {
  const lines = [columns.map(c => escapeCsvCell(c.header)).join(',')]
  for (const row of rows) {
    lines.push(columns.map(c => escapeCsvCell(toCell(c.value(row)))).join(','))
  }
  return lines.join('\r\n')
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.style.display = 'none'
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  // Safari (and iOS in particular) needs the object URL to outlive the click.
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function exportToCsv<T>(filename: string, rows: T[], columns: ExportColumn<T>[]) {
  // The BOM makes Excel read the file as UTF-8 rather than the local codepage.
  const blob = new Blob(['﻿', buildCsv(rows, columns)], {
    type: 'text/csv;charset=utf-8;',
  })
  triggerDownload(blob, filename)
}

export async function exportToXlsx<T>(
  filename: string,
  rows: T[],
  columns: ExportColumn<T>[],
  sheetName = 'Sheet1',
) {
  const { utils, write } = await import('xlsx')
  const aoa = [columns.map(c => c.header), ...rows.map(r => columns.map(c => toCell(c.value(r))))]
  const sheet = utils.aoa_to_sheet(aoa)
  sheet['!cols'] = columns.map(c => ({ wch: Math.max(12, c.header.length + 2) }))
  const book = utils.book_new()
  // Excel rejects sheet names over 31 chars or containing []:*?/\
  utils.book_append_sheet(book, sheet, sheetName.replace(/[[\]:*?/\\]/g, '').slice(0, 31) || 'Sheet1')
  const buffer = write(book, { bookType: 'xlsx', type: 'array' })
  triggerDownload(
    new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
    filename,
  )
}

/** `contacts` -> `contacts_2026-09-07.csv`, with anything path-unsafe stripped. */
export function timestampedFilename(base: string, extension: 'csv' | 'xlsx'): string {
  const slug = base.trim().replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '').toLowerCase()
  return `${slug || 'export'}_${new Date().toISOString().slice(0, 10)}.${extension}`
}
