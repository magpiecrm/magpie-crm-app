/* MagpieCRM survey embeds. Pasted after a survey's iframe, it grows each
   iframe marked data-magpie-survey to fit the page of the survey it shows,
   as people move through it. It only listens to the site it was loaded from.
   (Older embed codes carry the same resizing inline and keep working.) */
(function () {
  var script = document.currentScript;
  if (!script || window.__magpieSurveys) return;
  window.__magpieSurveys = true;
  var origin = new URL(script.src).origin;
  window.addEventListener('message', function (e) {
    if (e.origin !== origin || !e.data || e.data.type !== 'em-survey:height' || typeof e.data.id !== 'string') return;
    var frames = document.querySelectorAll('iframe[data-magpie-survey]');
    for (var i = 0; i < frames.length; i++) {
      if (frames[i].getAttribute('data-magpie-survey') === e.data.id && frames[i].contentWindow === e.source) {
        frames[i].style.height = Math.max(200, Math.ceil(Number(e.data.height) || 0)) + 'px';
      }
    }
  });
})();
