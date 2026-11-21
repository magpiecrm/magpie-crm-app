// The test stack's DNS: the app's lookups (MX before an email is guessed, a
// sending domain's SPF, DKIM and DMARC, a mailbox's mail server) are sent here
// (DNS_SERVERS, set by serve.ts), so the made-up companies have mail servers
// and the made-up sending domains can be made ready, and no lookup leaves the
// machine. Names it doesn't know get NXDOMAIN.

type Answer = { type: 'MX'; preference: number; exchange: string } | { type: 'TXT'; text: string } | { type: 'A'; address: string } | { type: 'CNAME'; target: string }

const TYPES = { A: 1, CNAME: 5, MX: 15, TXT: 16 } as const
const TYPE_NAMES: Record<number, string> = { 1: 'A', 5: 'CNAME', 15: 'MX', 16: 'TXT', 28: 'AAAA' }

export class Zone {
  private records = new Map<string, Answer[]>()

  set(name: string, answers: Answer[]) {
    this.records.set(name.toLowerCase().replace(/\.$/, ''), answers)
  }

  add(name: string, answer: Answer) {
    const key = name.toLowerCase().replace(/\.$/, '')
    this.records.set(key, [...(this.records.get(key) ?? []), answer])
  }

  remove(name: string, type?: Answer['type']) {
    const key = name.toLowerCase().replace(/\.$/, '')
    if (!type) return void this.records.delete(key)
    this.records.set(key, (this.records.get(key) ?? []).filter((a) => a.type !== type))
  }

  lookup(name: string, type: string): Answer[] | null {
    const all = this.records.get(name.toLowerCase().replace(/\.$/, ''))
    if (!all) return null
    return all.filter((a) => a.type === type || (a.type === 'CNAME' && type !== 'CNAME'))
  }
}

function readName(buf: Uint8Array, offset: number): [string, number] {
  const labels: string[] = []
  let i = offset
  while (buf[i] !== 0) {
    const len = buf[i]
    labels.push(new TextDecoder().decode(buf.subarray(i + 1, i + 1 + len)))
    i += len + 1
  }
  return [labels.join('.'), i + 1]
}

function encodeName(name: string): number[] {
  const out: number[] = []
  for (const label of name.replace(/\.$/, '').split('.')) {
    const bytes = new TextEncoder().encode(label)
    out.push(bytes.length, ...bytes)
  }
  out.push(0)
  return out
}

const u16 = (n: number) => [(n >> 8) & 0xff, n & 0xff]
const u32 = (n: number) => [(n >>> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]

function encodeAnswer(a: Answer): { type: number; data: number[] } {
  switch (a.type) {
    case 'MX':
      return { type: TYPES.MX, data: [...u16(a.preference), ...encodeName(a.exchange)] }
    case 'A':
      return { type: TYPES.A, data: a.address.split('.').map(Number) }
    case 'CNAME':
      return { type: TYPES.CNAME, data: encodeName(a.target) }
    case 'TXT': {
      const bytes = [...new TextEncoder().encode(a.text)]
      const data: number[] = []
      for (let i = 0; i < bytes.length || i === 0; i += 255) {
        const chunk = bytes.slice(i, i + 255)
        data.push(chunk.length, ...chunk)
      }
      return { type: TYPES.TXT, data }
    }
  }
}

export function answer(query: Uint8Array, zone: Zone, onQuery?: (name: string, type: string, found: boolean) => void): Uint8Array {
  const id = [query[0], query[1]]
  const [name, end] = readName(query, 12)
  const qtype = (query[end] << 8) | query[end + 1]
  const question = [...query.subarray(12, end + 4)]
  const typeName = TYPE_NAMES[qtype] ?? String(qtype)
  const found = zone.lookup(name, typeName)
  onQuery?.(name, typeName, !!found?.length)

  // Flags: response, recursion desired + available; rcode 3 (NXDOMAIN) for an unknown name.
  const rcode = found === null ? 3 : 0
  const answers = (found ?? []).map(encodeAnswer)
  const out = [...id, 0x81, 0x80 | rcode, ...u16(1), ...u16(answers.length), ...u16(0), ...u16(0), ...question]
  for (const a of answers) {
    // The name is a pointer back to the question's (offset 12).
    out.push(0xc0, 0x0c, ...u16(a.type), ...u16(1), ...u32(60), ...u16(a.data.length), ...a.data)
  }
  return new Uint8Array(out)
}
