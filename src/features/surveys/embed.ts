/**
 * The iframe embed snippet. An iframe (rather than Forms' inline script) lets
 * the embed reuse the hosted renderer — pages, logic and validation — with its
 * CSS isolated from the host site. The script only resizes the iframe to fit.
 */
export function surveyEmbedSnippet(origin: string, surveyId: string): string {
  const id = `em-survey-${surveyId}`
  return `<iframe id="${id}" src="${origin}/s/${surveyId}?embed=1" title="Survey" style="width:100%;min-height:320px;border:0;display:block" loading="lazy"></iframe>
<script>
  window.addEventListener('message', function (e) {
    if (e.origin !== ${JSON.stringify(origin)} || !e.data || e.data.type !== 'em-survey:height' || e.data.id !== ${JSON.stringify(surveyId)}) return;
    document.getElementById(${JSON.stringify(id)}).style.height = e.data.height + 'px';
  });
</script>`
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

// Then render the same embed code as above, with src set to \`url\`.`
}
