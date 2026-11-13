/** Where a response came from, as the results pages name it. */
export const SOURCE_LABELS: Record<string, string> = {
  email: 'Email link',
  email_inline: 'Answered in an email',
  link: 'Public link',
  embed: 'Website embed',
  qr: 'QR code',
}

/** The same, as a line about one response ("Answered in the email · November update"). */
export const SOURCE_PHRASES: Record<string, string> = {
  email: 'Opened from the email',
  email_inline: 'Answered in the email',
  link: 'Came by the public link',
  embed: 'Answered on your website',
  qr: 'Scanned the QR code',
}
