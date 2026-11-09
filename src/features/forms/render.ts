import { HONEYPOT, type FormStyle, type PublicForm, type ResolvedFormField } from './model'

/**
 * How a form looks to the people filling it in, as CSS. One source for the
 * builder's preview, the hosted page (and so the iframe embed) and the plain
 * HTML snippet, so what the builder shows is what a website gets. Scoped under
 * `.mf`, and plain CSS rather than the app's classes: it has to look the same
 * on someone else's site.
 */

const RADIUS = { square: '2px', rounded: '8px', pill: '999px' } as const

/** Dark text on a light button colour, white on a dark one. */
export function textOn(hex: string) {
  const n = parseInt(hex.slice(1), 16)
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4 ? '#111827' : '#ffffff'
}

export function formCssVars(style: Required<FormStyle>): Record<string, string> {
  return {
    '--mf-accent': style.accent,
    '--mf-accent-text': textOn(style.accent),
    '--mf-radius': RADIUS[style.corners],
  }
}

export const FORM_CSS = `
.mf-wrap{container-type:inline-size}
.mf{color-scheme:light;--mf-text:#111827;--mf-muted:#5b616e;--mf-border:#8f949d;--mf-chevron:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' fill='none' stroke='%235b616e' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m4 6 4 4 4-4'/%3E%3C/svg%3E");--mf-bg:#fff;--mf-error:#b42318;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:var(--mf-text);font-size:15px;line-height:1.5;display:flex;flex-direction:column;gap:18px;margin:0;text-align:left}
.mf *{box-sizing:border-box}
.mf-row{display:grid;grid-template-columns:1fr 1fr;gap:16px}
@container (max-width:340px){.mf-row{grid-template-columns:1fr}}
.mf-field{display:flex;flex-direction:column;gap:6px;min-width:0;border:0;padding:0;margin:0}
.mf-label{font-size:14px;font-weight:600;color:var(--mf-text);padding:0}
.mf-optional{font-weight:400;color:var(--mf-muted);font-size:13px;margin-left:6px}
.mf-input{appearance:none;width:100%;margin:0;padding:10px 12px;min-height:44px;border:1px solid var(--mf-border);border-radius:var(--mf-radius);background:var(--mf-bg);color:var(--mf-text);font:inherit;font-size:15px;line-height:1.4;box-shadow:none}
.mf-input::placeholder{color:var(--mf-muted);opacity:1}
.mf-input:focus{outline:2px solid var(--mf-accent);outline-offset:1px;border-color:var(--mf-accent)}
select.mf-input{background-image:var(--mf-chevron);background-position:right 12px center;background-size:16px 16px;background-repeat:no-repeat;padding-right:40px}
textarea.mf-input{min-height:112px;resize:vertical;border-radius:min(var(--mf-radius),12px)}
.mf-choices{display:flex;flex-direction:column;gap:8px}
.mf-check{display:flex;gap:10px;align-items:flex-start;font-size:14px;line-height:1.45;color:var(--mf-text);cursor:pointer}
.mf-check input{appearance:auto;-webkit-appearance:checkbox;width:18px;height:18px;margin:1px 0 0;flex:none;accent-color:var(--mf-accent);cursor:pointer}
.mf-invalid{border-color:var(--mf-error)}
.mf-error{color:var(--mf-error);font-size:13px;margin:0}
.mf-button{appearance:none;align-self:flex-start;display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:44px;padding:10px 22px;border:0;border-radius:var(--mf-radius);background:var(--mf-accent);color:var(--mf-accent-text);font:inherit;font-weight:600;cursor:pointer}
.mf-button:hover{filter:brightness(1.08)}
.mf-button:focus-visible{outline:2px solid var(--mf-accent);outline-offset:2px}
.mf-button[disabled]{opacity:.7;cursor:default}
.mf-done{display:flex;gap:12px;align-items:flex-start;padding:16px 18px;border:1px solid var(--mf-border);border-radius:min(var(--mf-radius),12px);background:var(--mf-bg)}
.mf-done-mark{flex:none;width:22px;height:22px;border-radius:999px;background:var(--mf-accent);color:var(--mf-accent-text);display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;line-height:1}
.mf-done p{margin:0;white-space:pre-line}
.mf-head{display:flex;flex-direction:column;gap:6px;margin-bottom:4px}
.mf-title{margin:0;font-size:22px;line-height:1.25;font-weight:700;letter-spacing:-.01em;color:var(--mf-text)}
.mf-intro{margin:0;font-size:15px;line-height:1.55;color:var(--mf-muted);white-space:pre-line}
.mf-help{margin:-2px 0 0;font-size:13px;line-height:1.45;color:var(--mf-muted)}
.mf-privacy{margin:-4px 0 0;font-size:13px;line-height:1.45;color:var(--mf-muted)}
.mf-privacy a{color:inherit;text-decoration:underline;text-underline-offset:2px}
.mf-preview-reset{appearance:none;align-self:flex-start;background:none;border:0;padding:0;color:var(--mf-muted);font:inherit;font-size:13px;text-decoration:underline;text-underline-offset:3px;cursor:pointer}
.mf-serif{font-family:Charter,"Bitstream Charter","Sitka Text",Cambria,Georgia,serif}
.mf-rounded{font-family:ui-rounded,"SF Pro Rounded","Nunito","Varela Round",-apple-system,"Segoe UI",sans-serif}
.mf-filled .mf-input{background:#eef0f3;border-color:transparent;border-bottom:2px solid var(--mf-border);border-radius:min(var(--mf-radius),8px) min(var(--mf-radius),8px) 0 0}
.mf-filled .mf-input:focus{border-bottom-color:var(--mf-accent)}
.mf-dark.mf-filled .mf-input,.mf-dark .mf-filled .mf-input{background:#2a2e35}
.mf-hp{position:absolute!important;left:-9999px!important;width:1px;height:1px;overflow:hidden}
.mf-dark{color-scheme:dark;--mf-text:#f4f4f5;--mf-muted:#a1a1aa;--mf-border:#737985;--mf-bg:#1d2025;--mf-error:#f97066;--mf-chevron:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' fill='none' stroke='%23a1a1aa' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m4 6 4 4 4-4'/%3E%3C/svg%3E")}
`.trim()

/** The form's classes for its look: theme, font and field style. */
export function formClass(style: Required<FormStyle>) {
  return ['mf', style.theme === 'dark' && 'mf-dark', style.font !== 'sans' && `mf-${style.font}`, style.fields === 'filled' && 'mf-filled'].filter(Boolean).join(' ')
}

/** Fields as the page lays them out: first and last name side by side. */
export function layoutRows(fields: ResolvedFormField[]): ResolvedFormField[][] {
  const rows: ResolvedFormField[][] = []
  for (let i = 0; i < fields.length; i++) {
    const f = fields[i]
    const next = fields[i + 1]
    if (f.key === 'first_name' && next?.key === 'last_name') {
      rows.push([f, next])
      i++
    } else rows.push([f])
  }
  return rows
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

function fieldHtml(f: ResolvedFormField, id: string): string {
  const name = esc(f.key)
  const fid = `${id}-${f.key.replace(/[^a-z0-9_-]/gi, '_')}`
  const req = f.required ? ' required' : ''
  const optional = f.required ? '' : '<span class="mf-optional">Optional</span>'
  const ph = f.placeholder ? ` placeholder="${esc(f.placeholder)}"` : ''
  if (f.type === 'checkbox') {
    return `<label class="mf-check"><input type="checkbox" name="${name}" value="yes"${req}> <span>${esc(f.label)}${optional}</span></label>`
  }
  if (f.type === 'multiselect') {
    const opts = (f.options ?? []).map((o) => `<label class="mf-check"><input type="checkbox" name="${name}" value="${esc(o)}"> <span>${esc(o)}</span></label>`).join('')
    return `<fieldset class="mf-field"><legend class="mf-label">${esc(f.label)}${optional}</legend><div class="mf-choices">${opts}</div></fieldset>`
  }
  let control: string
  if (f.type === 'textarea') control = `<textarea class="mf-input" id="${fid}" name="${name}" rows="4"${ph}${req}></textarea>`
  else if (f.type === 'select') {
    control = `<select class="mf-input" id="${fid}" name="${name}"${req}><option value="">Choose…</option>${(f.options ?? []).map((o) => `<option>${esc(o)}</option>`).join('')}</select>`
  } else {
    const t = f.type === 'email' ? 'email' : f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'
    const auto = { email: 'email', first_name: 'given-name', last_name: 'family-name', company: 'organization', job_title: 'organization-title' }[f.key]
    control = `<input class="mf-input" id="${fid}" type="${t}" name="${name}"${auto ? ` autocomplete="${auto}"` : ''}${ph}${req}>`
  }
  const help = f.help ? `<p class="mf-help" id="${fid}-help">${esc(f.help)}</p>` : ''
  return `<div class="mf-field"><label class="mf-label" for="${fid}">${esc(f.label)}${optional}</label>${help}${control}</div>`
}

/**
 * A form as plain HTML, for someone who wants to style it with their own CSS.
 * It works without JavaScript (the post lands on the hosted page's thank-you);
 * with it, the thanks shows in place.
 */
export function plainHtmlSnippet(form: PublicForm, origin: string): string {
  const id = `mf-${form.id}`
  const vars = Object.entries(formCssVars(form.style)).map(([k, v]) => `${k}:${v}`).join(';')
  const hidden = form.fields.filter((f) => f.hidden)
  const rows = layoutRows(form.fields.filter((f) => !f.hidden))
    .map((row) => (row.length > 1 ? `  <div class="mf-row">${row.map((f) => fieldHtml(f, id)).join('')}</div>` : `  ${fieldHtml(row[0], id)}`))
    .join('\n')
  const action = `${origin}/api/form-submit/${form.id}`
  return `<style>
${FORM_CSS}
#${id}{${vars}}
</style>
<div class="mf-wrap">
<form class="${formClass(form.style)}" id="${id}" action="${esc(action)}" method="post">
${form.heading || form.intro ? `  <div class="mf-head">${form.heading ? `<h2 class="mf-title">${esc(form.heading)}</h2>` : ''}${form.intro ? `<p class="mf-intro">${esc(form.intro)}</p>` : ''}</div>\n` : ''}${rows}
${hidden.map((f) => `  <input type="hidden" name="${esc(f.key)}" data-param="${esc(f.param)}">\n`).join('')}  <div class="mf-hp" aria-hidden="true"><input name="${HONEYPOT}" tabindex="-1" autocomplete="off"></div>
  <button class="mf-button" type="submit">${esc(form.submitLabel)}</button>
${form.privacyUrl ? `  <p class="mf-privacy">How we use your details: <a href="${esc(form.privacyUrl)}" target="_blank" rel="noopener">privacy policy</a></p>\n` : ''}</form>
</div>
<script>
(function () {
  var f = document.getElementById(${JSON.stringify(id)});
  f.addEventListener('submit', function (e) {
    e.preventDefault();
    var data = {};
    new FormData(f).forEach(function (v, k) { data[k] = k in data ? [].concat(data[k], v) : v; });
    data._page = location.href; data._referrer = document.referrer;
    var q = new URLSearchParams(location.search);
    f.querySelectorAll('input[data-param]').forEach(function (h) { if (q.get(h.getAttribute('data-param'))) data[h.name] = q.get(h.getAttribute('data-param')); });
    var b = f.querySelector('button'); b.disabled = true;
    fetch(f.action, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (r) {
        if (r.ok && r.j.redirect) { location.href = r.j.redirect; return; }
        if (r.ok) { f.innerHTML = '<div class="mf-done"><span class="mf-done-mark">&#10003;</span><p></p></div>'; f.querySelector('p').textContent = r.j.message || ${JSON.stringify(form.successMessage)}; }
        else fail(r.j.error);
      })
      .catch(function () { fail(); });
    function fail(msg) {
      b.disabled = false;
      var p = f.querySelector('.mf-error') || f.insertBefore(document.createElement('p'), b);
      p.className = 'mf-error'; p.setAttribute('role', 'alert');
      p.textContent = msg || 'Something went wrong. Please try again.';
    }
  });
})();
</script>`
}

/**
 * The recommended embed: the hosted page in an iframe, and a small script
 * (public/forms/embed.js) that grows it to fit the form.
 */
export function iframeSnippet(formId: string, origin: string, name: string): string {
  return `<iframe
  data-magpie-form="${formId}"
  src="${origin}/f/${formId}?embed=1"
  title="${esc(name)}"
  style="width:100%;height:420px;border:0"
  loading="lazy"></iframe>
<script src="${origin}/forms/embed.js" async></script>`
}

/** The form as a pop-up: the same script shows it after `delay` seconds, once per visitor. */
export function popupSnippet(form: Pick<PublicForm, 'id' | 'name' | 'style'>, origin: string, delay: number): string {
  return `<script
  src="${origin}/forms/embed.js"
  data-magpie-popup="${form.id}"
  data-delay="${delay}"
  data-title="${esc(form.name)}"${form.style.theme === 'dark' ? '\n  data-theme="dark"' : ''}
  async></script>`
}

export const hostedUrl = (formId: string, origin: string) => `${origin}/f/${formId}`
