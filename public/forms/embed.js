/* MagpieCRM form embeds: grows each form's iframe to fit the form inside it,
   and tells the form which page it's on. Pasted with the iframe; it only
   talks to the site it was loaded from. */
(function () {
  var script = document.currentScript;
  if (!script || window.__magpieForms) return;
  window.__magpieForms = true;
  var origin = new URL(script.src).origin;
  window.addEventListener('message', function (e) {
    if (e.origin !== origin || !e.data || typeof e.data.id !== 'string') return;
    // The form asks which page it's on, so a submission can say where it came from.
    if (e.data.type === 'magpie-form:hello' && e.source) {
      e.source.postMessage({ type: 'magpie-form:page', id: e.data.id, url: location.href, referrer: document.referrer }, origin);
      return;
    }
    if (e.data.type !== 'magpie-form:height') return;
    var frames = document.querySelectorAll('iframe[data-magpie-form]');
    for (var i = 0; i < frames.length; i++) {
      if (frames[i].getAttribute('data-magpie-form') === e.data.id) frames[i].style.height = Math.max(0, Math.min(5000, Number(e.data.height) || 0)) + 'px';
    }
  });
})();
