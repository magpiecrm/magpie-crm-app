/**
 * The embed code: the survey's iframe and the small hosted script that sizes
 * it (`public/surveys/embed.js`), so what's pasted is two short lines.
 */
export function surveyEmbedCode(origin: string, surveyId: string, name: string): string {
  const title = `Survey: ${name}`.replace(/"/g, '&quot;')
  return `<iframe src="${origin}/s/${surveyId}?embed=1" title="${title}" data-magpie-survey="${surveyId}" style="width:100%;min-height:320px;border:0;display:block" loading="lazy"></iframe>
<script src="${origin}/surveys/embed.js" async></script>`
}

/**
 * Server-side example for embedding for signed-in users: the host app's
 * backend swaps its API key and the user's email for a personal iframe URL.
 */
export function surveySignedEmbedExample(origin: string, surveyId: string): string {
  return `// On YOUR server (never in the browser — the API key is a secret):
const res = await fetch(${JSON.stringify(`${origin}/api/surveys/${surveyId}/token`)}, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-API-Key': process.env.SURVEY_API_KEY },
  body: JSON.stringify({ email: user.email, firstName: user.firstName, lastName: user.lastName }),
})
const { url } = await res.json() // valid for 24 hours

// Then paste the same embed code as above, with the iframe's src set to \`url\`.`
}
