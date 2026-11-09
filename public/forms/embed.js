/* MagpieCRM form embeds: grows each form's iframe to fit the form inside it.
   Pasted with the iframe; it only listens to the site it was loaded from. */
(function () {
  var script = document.currentScript;
  if (!script || window.__magpieForms) return;
  window.__magpieForms = true;
  var origin = new URL(script.src).origin;
  window.addEventListener('message', function (e) {
    if (e.origin !== origin || !e.data || e.data.type !== 'magpie-form:height' || typeof e.data.id !== 'string') return;
    var frames = document.querySelectorAll('iframe[data-magpie-form]');
    for (var i = 0; i < frames.length; i++) {
      if (frames[i].getAttribute('data-magpie-form') === e.data.id) frames[i].style.height = Math.max(0, Math.min(5000, Number(e.data.height) || 0)) + 'px';
    }
  });
})();
