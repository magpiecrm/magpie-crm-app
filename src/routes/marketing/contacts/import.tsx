import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '../../../queryKeys'
import { useState } from 'react'
import { 
  listsFn, 
  addContactsFn 
} from '../../../server/functions'
import { 
  ArrowLeft, 
  FileSpreadsheet, 
  Copy, 
  Puzzle, 
  Check, 
  Loader2, 
  Upload, 
  AlertCircle
} from 'lucide-react'

export const Route = createFileRoute('/marketing/contacts/import')({
  component: ImportContactsPage,
})

type ImportMode = 'select' | 'file' | 'copy-paste' | 'another-tool'

// Helper to detect CSV delimiter
function detectDelimiter(text: string): string {
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
function parseCSV(text: string, delimiter: string): string[][] {
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

function isSpreadsheetFile(file: File): boolean {
  const name = file.name.toLowerCase()
  return SPREADSHEET_EXTENSIONS.some(ext => name.endsWith(ext))
}

// Read the first sheet of an Excel/ODS workbook into the same string grid
// shape the CSV parser produces
async function parseSpreadsheet(file: File): Promise<string[][]> {
  const { read, utils } = await import('xlsx')
  const workbook = read(await file.arrayBuffer(), { type: 'array' })
  const sheetName = workbook.SheetNames[0]
  if (!sheetName) return []

  const rows = utils.sheet_to_json<any[]>(workbook.Sheets[sheetName], {
    header: 1,
    blankrows: false,
    raw: false, // let SheetJS format dates/numbers as display strings
    defval: '',
  })

  return rows
    .map(row => row.map(cell => (cell == null ? '' : String(cell).trim())))
    .filter(row => row.some(cell => cell !== ''))
}

// Auto detect fields from columns
function autoDetectMappings(grid: string[][], hasHeaders: boolean): Record<number, string> {
  const mappings: Record<number, string> = {}
  if (grid.length === 0) return mappings
  
  const numCols = Math.max(...grid.map(row => row.length))
  
  // 1. Try to match headers if present
  if (hasHeaders) {
    const firstRow = grid[0]
    for (let colIdx = 0; colIdx < firstRow.length; colIdx++) {
      const val = (firstRow[colIdx] || '').toLowerCase().trim()
      if (val.includes('email') || val.includes('mail') || val === 'addr') {
        mappings[colIdx] = 'email'
      } else if (val.includes('first') || val.includes('fname') || val === 'name') {
        mappings[colIdx] = 'firstName'
      } else if (val.includes('last') || val.includes('lname')) {
        mappings[colIdx] = 'lastName'
      } else if (val.includes('company') || val.includes('org') || val.includes('business')) {
        mappings[colIdx] = 'company'
      } else if (val.includes('title') || val.includes('role') || val.includes('job')) {
        mappings[colIdx] = 'jobTitle'
      }
    }
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
  
  return mappings;
}

function ImportContactsPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [mode, setMode] = useState<ImportMode>('select')
  const [targetListId, setTargetListId] = useState<number | ''>('')
  const [rawText, setRawText] = useState('')
  const [dragActive, setDragActive] = useState(false)
  const [isParsingFile, setIsParsingFile] = useState(false)
  const [grid, setGrid] = useState<string[][]>([])
  const [hasHeaders, setHasHeaders] = useState(true)
  const [mappings, setMappings] = useState<Record<number, string>>({})
  const [error, setError] = useState<string | null>(null)

  // Fetch lists for the target dropdown
  const { data: listsData } = useQuery({
    queryKey: queryKeys.email.lists(),
    queryFn: () => listsFn(),
  })
  const lists = listsData?.lists || []

  // Mutation to add contacts to a list
  const importMutation = useMutation({
    mutationFn: (data: { listId: number; contacts: any[] }) => addContactsFn({ data }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.email.contacts() })
      queryClient.invalidateQueries({ queryKey: queryKeys.email.lists() })
      alert(
        res?.skipped
          ? `Imported ${res.added} contact${res.added === 1 ? '' : 's'}. ${res.skipped} ${res.skipped === 1 ? 'was' : 'were'} skipped: they opted out of being contacted.`
          : 'Contacts imported successfully!',
      )
      navigate({ to: '/marketing/contacts' })
    },
    onError: (err: any) => {
      setError(`Import failed: ${err.message}`)
    }
  })

  // Parse pasted text or CSV content
  const handleParse = (text: string) => {
    setError(null)
    const delimiter = detectDelimiter(text)
    const parsedGrid = parseCSV(text, delimiter)

    if (parsedGrid.length === 0) {
      setError('Could not find any data in the input.')
      return
    }

    setGrid(parsedGrid)
    const initialMappings = autoDetectMappings(parsedGrid, hasHeaders)
    setMappings(initialMappings)
  }

  // Apply an already-parsed grid (spreadsheet path — no delimiter guessing)
  const applyGrid = (parsedGrid: string[][]) => {
    if (parsedGrid.length === 0) {
      setError('Could not find any data in the input.')
      return
    }
    setGrid(parsedGrid)
    setMappings(autoDetectMappings(parsedGrid, hasHeaders))
  }

  // Handle CSV/text or spreadsheet file upload
  const handleFile = async (file: File) => {
    setError(null)

    if (isSpreadsheetFile(file)) {
      setIsParsingFile(true)
      try {
        applyGrid(await parseSpreadsheet(file))
      } catch (err: any) {
        setError(`Could not read "${file.name}": ${err?.message || 'unsupported or corrupted spreadsheet.'}`)
      } finally {
        setIsParsingFile(false)
      }
      return
    }

    const reader = new FileReader()
    reader.onload = (event) => {
      handleParse(event.target?.result as string)
    }
    reader.onerror = () => {
      setError('Failed to read the file.')
    }
    reader.readAsText(file)
  }

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
    e.target.value = '' // allow re-selecting the same file after a clear
  }

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true)
    } else if (e.type === "dragleave") {
      setDragActive(false)
    }
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragActive(false)
    setError(null)

    const file = e.dataTransfer.files?.[0]
    if (file) handleFile(file)
  }

  const handleToggleHeaders = (checked: boolean) => {
    setHasHeaders(checked)
    setMappings(autoDetectMappings(grid, checked))
  }

  const handleSubmit = () => {
    if (!targetListId) {
      setError('Please select a target contact list.')
      return
    }

    // Find email column
    const emailColIdxStr = Object.keys(mappings).find(key => mappings[Number(key)] === 'email')
    if (emailColIdxStr === undefined) {
      setError('Please map at least one column to the "Email" field.')
      return
    }
    const emailColIdx = Number(emailColIdxStr)

    const firstNameColIdxStr = Object.keys(mappings).find(key => mappings[Number(key)] === 'firstName')
    const firstNameColIdx = firstNameColIdxStr !== undefined ? Number(firstNameColIdxStr) : -1

    const lastNameColIdxStr = Object.keys(mappings).find(key => mappings[Number(key)] === 'lastName')
    const lastNameColIdx = lastNameColIdxStr !== undefined ? Number(lastNameColIdxStr) : -1

    const companyColIdxStr = Object.keys(mappings).find(key => mappings[Number(key)] === 'company')
    const companyColIdx = companyColIdxStr !== undefined ? Number(companyColIdxStr) : -1

    const jobTitleColIdxStr = Object.keys(mappings).find(key => mappings[Number(key)] === 'jobTitle')
    const jobTitleColIdx = jobTitleColIdxStr !== undefined ? Number(jobTitleColIdxStr) : -1

    const contactsList: { email: string; attributes?: any }[] = []
    const startRow = hasHeaders ? 1 : 0

    for (let i = startRow; i < grid.length; i++) {
      const row = grid[i]
      const email = row[emailColIdx]
      if (!email || !email.includes('@')) {
        continue // skip rows with invalid/missing emails
      }

      const attributes: any = {}
      if (firstNameColIdx !== -1 && row[firstNameColIdx]) attributes.FIRSTNAME = row[firstNameColIdx]
      if (lastNameColIdx !== -1 && row[lastNameColIdx]) attributes.LASTNAME = row[lastNameColIdx]
      if (companyColIdx !== -1 && row[companyColIdx]) attributes.COMPANY = row[companyColIdx]
      if (jobTitleColIdx !== -1 && row[jobTitleColIdx]) attributes.JOB_TITLE = row[jobTitleColIdx]

      contactsList.push({
        email,
        attributes: Object.keys(attributes).length > 0 ? attributes : undefined
      })
    }

    if (contactsList.length === 0) {
      setError('Could not find any valid email addresses based on your current column mappings.')
      return
    }

    importMutation.mutate({
      listId: Number(targetListId),
      contacts: contactsList
    })
  }

  // Preview properties
  const numColumns = grid.length > 0 ? Math.max(...grid.map(row => row.length)) : 0
  const sampleRows = grid.slice(0, 6)

  return (
    <div className="p-4 lg:p-8 max-w-5xl mx-auto min-h-[100dvh]">
      {/* Header */}
      <div className="mb-8">
        <button
          onClick={() => mode !== 'select' ? setMode('select') : navigate({ to: '/marketing/contacts' })}
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-accent transition-colors group mb-4 cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" />
          Back to contacts
        </button>
        <h1 className="text-2xl font-bold text-foreground mb-2">
          {mode === 'select' ? 'Import contacts for bulk creation or updating' : `Import contacts via ${mode === 'file' ? 'File' : 'Copy-paste'}`}
        </h1>
        <p className="text-muted-foreground text-sm max-w-2xl">
          Create, update, or blocklist contacts in bulk locally. Keep in mind you must have your contacts' consent to send them campaigns.
        </p>
      </div>

      {error && (
        <div className="bg-destructive/10 border border-destructive/20 text-destructive text-sm p-4 rounded-xl mb-6 flex items-start gap-2.5">
          <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
          <div>{error}</div>
        </div>
      )}

      {/* SELECT MODE */}
      {mode === 'select' && (
        <div className="space-y-8">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Option 1: File */}
            <div 
              onClick={() => setMode('file')}
              className="bg-card border border-border rounded-2xl p-6 hover:border-accent/40 cursor-pointer shadow-premium transition-all hover:-translate-y-0.5 flex flex-col items-start text-left space-y-4"
            >
              <div className="p-3 bg-emerald-500/10 text-emerald-600 rounded-xl">
                <FileSpreadsheet className="w-6 h-6" />
              </div>
              <div>
                <h3 className="font-bold text-foreground mb-1">Import from a file</h3>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Import your contacts from a .csv, .xlsx, or .txt file.
                </p>
              </div>
            </div>

            {/* Option 2: Copy Paste */}
            <div 
              onClick={() => setMode('copy-paste')}
              className="bg-card border border-border rounded-2xl p-6 hover:border-accent/40 cursor-pointer shadow-premium transition-all hover:-translate-y-0.5 flex flex-col items-start text-left space-y-4"
            >
              <div className="p-3 bg-amber-500/10 text-amber-600 rounded-xl">
                <Copy className="w-6 h-6" />
              </div>
              <div>
                <h3 className="font-bold text-foreground mb-1">Copy-paste</h3>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Paste the contacts as text from a spreadsheet or a similar list.
                </p>
              </div>
            </div>

            {/* Option 3: Integration */}
            <div 
              onClick={() => alert('Integrations coming soon!')}
              className="bg-card border border-border rounded-2xl p-6 hover:border-accent/40 cursor-pointer shadow-premium transition-all hover:-translate-y-0.5 flex flex-col items-start text-left space-y-4"
            >
              <div className="p-3 bg-accent/10 text-accent rounded-xl">
                <Puzzle className="w-6 h-6" />
              </div>
              <div>
                <h3 className="font-bold text-foreground mb-1">Import from another tool</h3>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Import contacts automatically from the other tools you already use.
                </p>
              </div>
            </div>
          </div>

          {/* Other ways to add contacts */}
          <div className="pt-6 border-t border-border/80">
            <h4 className="text-sm font-bold text-foreground mb-4">Additional ways to grow your contact list</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="bg-card border border-border rounded-2xl p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-sm">
                <div>
                  <h5 className="font-bold text-sm text-foreground mb-1">Forms</h5>
                  <p className="text-xs text-muted-foreground">Attract new subscribers with easy-to-embed signup forms.</p>
                </div>
                <button className="px-4 py-2 border border-border text-foreground hover:bg-muted/50 rounded-xl transition-all text-xs font-semibold shrink-0 cursor-pointer">
                  Try Forms
                </button>
              </div>
              <div className="bg-card border border-border rounded-2xl p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-sm">
                <div>
                  <h5 className="font-bold text-sm text-foreground mb-1">Landing pages</h5>
                  <p className="text-xs text-muted-foreground">Convert visitors into customers with branded landing pages.</p>
                </div>
                <button className="px-4 py-2 border border-border text-foreground hover:bg-muted/50 rounded-xl transition-all text-xs font-semibold shrink-0 cursor-pointer">
                  Try Landing pages
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* FILE UPLOAD MODE */}
      {mode === 'file' && grid.length === 0 && (
        <div className="bg-card border border-border rounded-2xl p-4 sm:p-6 shadow-sm space-y-6">
          <div 
            onDragEnter={handleDrag}
            onDragOver={handleDrag}
            onDragLeave={handleDrag}
            onDrop={handleDrop}
            className={`border-2 border-dashed rounded-2xl p-6 sm:p-10 text-center flex flex-col items-center justify-center gap-4 transition-all ${
              dragActive ? 'border-accent bg-accent/5' : 'border-border bg-muted/20'
            }`}
          >
            {isParsingFile ? (
              <Loader2 className="w-10 h-10 text-muted-foreground opacity-70 animate-spin" />
            ) : (
              <Upload className="w-10 h-10 text-muted-foreground opacity-70" />
            )}
            <div>
              <p className="font-bold text-sm text-foreground mb-1">
                {isParsingFile ? 'Reading your file…' : (
                  <>
                    <span className="hidden sm:inline">Drag and drop your file here</span>
                    <span className="sm:hidden">Choose a file to import</span>
                  </>
                )}
              </p>
              <p className="text-xs text-muted-foreground">Excel (.xlsx, .xls), CSV, or plain text. You can map headers to Email, First Name, Last Name, and Company in the next step.</p>
            </div>
            <label className={`px-5 py-2.5 bg-primary text-primary-foreground rounded-xl text-xs font-semibold transition-all ${
              isParsingFile ? 'opacity-60 pointer-events-none' : 'hover:brightness-110 active:scale-95 cursor-pointer'
            }`}>
              Choose file
              <input
                type="file"
                accept=".csv,.txt,.tsv,.xlsx,.xlsm,.xlsb,.xls,.ods"
                onChange={handleFileUpload}
                disabled={isParsingFile}
                className="hidden"
              />
            </label>
          </div>
        </div>
      )}

      {/* COPY-PASTE MODE */}
      {mode === 'copy-paste' && grid.length === 0 && (
        <div className="bg-card border border-border rounded-2xl p-6 shadow-sm space-y-6">
          <div className="space-y-2">
            <label className="text-xs font-bold text-muted-foreground block">Paste contact rows</label>
            <p className="text-[11px] text-muted-foreground">Format: columns separated by comma, semicolon, or tab. (one row per line)</p>
            <textarea
              rows={8}
              placeholder="jane@example.com, Jane, Doe, Acme Corp&#10;john@example.com, John, Smith"
              value={rawText}
              onChange={(e) => setRawText(e.target.value)}
              className="w-full px-4 py-3 rounded-lg border border-border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-accent font-mono text-sm placeholder:font-sans"
            />
          </div>

          <div className="flex justify-between items-center">
            <button
              onClick={() => handleParse(rawText)}
              className="px-4 py-2 bg-primary text-primary-foreground font-semibold rounded-xl transition-all text-xs cursor-pointer hover:bg-primary/85 active:scale-95"
            >
              Parse & Map Data
            </button>
          </div>
        </div>
      )}

      {/* COLUMN MAPPING AND PREVIEW (Visible once grid is parsed) */}
      {grid.length > 0 && (
        <div className="bg-card border border-border rounded-2xl p-6 shadow-sm space-y-6">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 pb-4 border-b border-border">
            <div>
              <h3 className="font-bold text-base text-foreground flex items-center gap-2">
                <Check className="w-5 h-5 text-emerald-500" />
                Parsed {grid.length} rows successfully
              </h3>
              <p className="text-xs text-muted-foreground mt-0.5">Map each column in your file to a field on your contact profile.</p>
            </div>
            
            <div className="flex items-center gap-2 bg-muted/30 px-3 py-1.5 rounded-lg border border-border/50">
              <input
                type="checkbox"
                id="has-headers-checkbox"
                checked={hasHeaders}
                onChange={(e) => handleToggleHeaders(e.target.checked)}
                className="w-4 h-4 accent-accent rounded"
              />
              <label htmlFor="has-headers-checkbox" className="text-xs font-semibold text-foreground select-none cursor-pointer">
                First row contains headers
              </label>
            </div>
          </div>

          {/* Interactive mapping table */}
          <div className="overflow-x-auto border border-border">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-muted/40 border-b border-border">
                  {Array.from({ length: numColumns }).map((_, colIdx) => (
                    <th key={colIdx} className="p-4 min-w-[200px] border-r border-border/60 last:border-r-0">
                      <div className="space-y-2">
                        <span className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground block">
                          Column {colIdx + 1}
                        </span>
                        
                        <select
                          value={mappings[colIdx] || 'skip'}
                          onChange={(e) => {
                            const val = e.target.value
                            setMappings(prev => {
                              const next = { ...prev }
                              if (val !== 'skip') {
                                // Enforce uniqueness of mapping fields
                                for (const idx in next) {
                                  if (next[idx] === val) {
                                    next[idx] = 'skip'
                                  }
                                }
                              }
                              next[colIdx] = val
                              return next
                            })
                          }}
                          className={`w-full text-xs font-semibold px-2 py-1.5 rounded border bg-background focus:outline-none focus:ring-1 focus:ring-accent ${
                            mappings[colIdx] === 'email' ? 'border-emerald-500/50 text-emerald-600' :
                            mappings[colIdx] && mappings[colIdx] !== 'skip' ? 'border-accent/50 text-accent' : 'border-border text-muted-foreground'
                          }`}
                        >
                          <option value="skip">Do not import (Skip)</option>
                          <option value="email">Email</option>
                          <option value="firstName">First Name</option>
                          <option value="lastName">Last Name</option>
                          <option value="company">Company</option>
                          <option value="jobTitle">Job Title</option>
                        </select>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sampleRows.map((row, rowIdx) => {
                  const isHeaderRow = hasHeaders && rowIdx === 0
                  return (
                    <tr 
                      key={rowIdx} 
                      className={`border-b border-border last:border-b-0 text-xs ${
                        isHeaderRow ? 'bg-muted/20 font-medium italic text-muted-foreground' : 'text-foreground'
                      }`}
                    >
                      {Array.from({ length: numColumns }).map((_, colIdx) => (
                        <td key={colIdx} className="p-3 border-r border-border/40 last:border-r-0 truncate max-w-[240px]">
                          {row[colIdx] || <span className="opacity-30">-</span>}
                          {isHeaderRow && colIdx === 0 && (
                            <span className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded text-[9px] bg-muted text-muted-foreground font-sans not-italic font-bold uppercase">
                              Header Row
                            </span>
                          )}
                        </td>
                      ))}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          
          <p className="text-[11px] text-muted-foreground italic">
            * Showing up to 5 rows of sample data.
          </p>

          <div className="space-y-4 pt-4 border-t border-border">
            {/* Destination list select */}
            <div className="space-y-2">
              <label className="text-xs font-bold text-muted-foreground block">Select target contact list</label>
              <select
                value={targetListId}
                onChange={(e) => setTargetListId(e.target.value ? Number(e.target.value) : '')}
                className="w-full md:w-80 px-4 py-2.5 rounded-lg border border-border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-accent text-sm"
              >
                <option value="">-- Choose list --</option>
                {lists.map((l: any) => (
                  <option key={l.id} value={l.id}>{l.name} (ID: {l.id})</option>
                ))}
              </select>
            </div>

            <div className="flex gap-3 pt-2">
              <button
                disabled={importMutation.isPending}
                onClick={handleSubmit}
                className="px-5 py-2.5 bg-primary text-primary-foreground font-semibold rounded-xl hover:bg-primary/85 active:scale-95 transition-all text-sm flex items-center gap-2 cursor-pointer"
              >
                {importMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                Confirm Import
              </button>
              <button
                onClick={() => {
                  setGrid([])
                  setMappings({})
                  setTargetListId('')
                  setRawText('')
                }}
                className="px-5 py-2.5 border border-border text-muted-foreground hover:bg-muted/50 rounded-xl transition-all text-sm font-semibold cursor-pointer"
              >
                Cancel / Clear
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
