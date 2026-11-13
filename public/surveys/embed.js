/* MagpieCRM survey embeds. Pasted after a survey's iframe, it grows each
   iframe marked data-magpie-survey to fit the page of the survey it shows,
   as people move through it. With data-magpie-survey-popup on this script
   tag it shows the survey over the page instead, after data-delay seconds
   (8 if not set): data-mode="popup" in the middle, "slide" in the corner.
   The pop-up loads out of sight and only shows once its survey says it's
   open, so a closed, deleted or unreachable survey never covers the page.
   Closing it or finishing the survey stops it showing again for 30 days.
   It only listens to the site it was loaded from, and only to its own
   frames. (Older embed codes carry the resizing inline and keep working.) */
(function () {
  var script = document.currentScript;
  if (!script) return;
  var origin = new URL(script.src).origin;

  // The survey frame a message came from, if it's one of ours on this page.
  function frameFor(e) {
    var frames = document.querySelectorAll('iframe[data-magpie-survey]');
    for (var i = 0; i < frames.length; i++) {
      if (frames[i].contentWindow === e.source && frames[i].getAttribute('data-magpie-survey') === e.data.id) return frames[i];
    }
    return null;
  }

  if (!window.__magpieSurveys) {
    window.__magpieSurveys = true;
    window.addEventListener('message', function (e) {
      if (e.origin !== origin || !e.data || typeof e.data.id !== 'string') return;
      var frame = frameFor(e);
      if (!frame) return;
      if (e.data.type === 'em-survey:done') { remember(e.data.id); return; }
      if (e.data.type === 'em-survey:escape') { if (frame.__magpieShut) frame.__magpieShut(); return; }
      if (e.data.type !== 'em-survey:height') return;
      frame.style.height = Math.max(200, Math.min(5000, Math.ceil(Number(e.data.height) || 0))) + 'px';
      // Pages from before `state` was sent only ever came from an open survey.
      if (frame.__magpieReveal && (e.data.state === undefined || e.data.state === 'open')) frame.__magpieReveal();
    });
  }

  // A survey that loaded before this script told its height to nobody (the
  // script is async, so it can arrive late): ask each one on the page again.
  var shown = document.querySelectorAll('iframe[data-magpie-survey]');
  for (var j = 0; j < shown.length; j++) {
    try { shown[j].contentWindow.postMessage({ type: 'em-survey:measure' }, origin); } catch (err) {}
  }

  function key(id) { return 'magpie-survey-popup:' + id; }
  function remember(id) { try { localStorage.setItem(key(id), String(Date.now())); } catch (err) {} }
  function seen(id) {
    try { var at = Number(localStorage.getItem(key(id))); return at && Date.now() - at < 30 * 864e5; } catch (err) { return false; }
  }

  var popup = script.getAttribute('data-magpie-survey-popup');
  if (!popup || !/^[\w-]{1,80}$/.test(popup) || seen(popup)) return;
  var slide = script.getAttribute('data-mode') === 'slide';
  var asked = script.getAttribute('data-delay');
  var delay = asked === null || asked === '' || !isFinite(Number(asked)) ? 8 : Math.max(0, Math.min(120, Number(asked)));
  var title = script.getAttribute('data-title') || 'Survey';

  function build() {
    var wrap = document.createElement('div');
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-modal', slide ? 'false' : 'true');
    wrap.setAttribute('aria-label', title);
    wrap.setAttribute('data-magpie-survey-open', popup);
    // Out of sight, and out of the way, until the survey says it's there to answer.
    wrap.setAttribute('aria-hidden', 'true');
    // On a narrow screen a slide-in is a sheet along the bottom; on a wide one it sits 24px in from the corner.
    var narrow = window.innerWidth < 640;
    wrap.style.cssText = (slide
      ? (narrow ? 'position:fixed;left:0;right:0;bottom:0;z-index:2147483000' : 'position:fixed;right:24px;bottom:24px;z-index:2147483000;width:min(400px,calc(100vw - 48px))')
      : 'position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(17,19,22,.45)') + ';visibility:hidden;pointer-events:none';
    var panel = document.createElement('div');
    panel.style.cssText = 'position:relative;width:100%;max-width:' + (slide ? (narrow ? 'none' : '400px') : '560px') + ';max-height:' + (slide ? 'min(560px, 75vh)' : 'calc(100vh - 32px)') + ';overflow:auto;background:#fff;border-radius:' + (slide && narrow ? '16px 16px 0 0' : '14px') + ';padding:36px 0 0;box-shadow:0 24px 64px -12px rgba(0,0,0,.35);outline:none';
    panel.tabIndex = -1;
    var close = document.createElement('button');
    close.type = 'button';
    close.setAttribute('aria-label', 'Close');
    close.innerHTML = '&times;';
    close.style.cssText = 'position:absolute;top:2px;right:6px;width:36px;height:36px;border:0;border-radius:999px;background:transparent;font:24px/1 system-ui,sans-serif;color:#5b616e;cursor:pointer';
    close.addEventListener('mouseenter', function () { close.style.background = 'rgba(17,19,22,.06)'; });
    close.addEventListener('mouseleave', function () { close.style.background = 'transparent'; });
    var frame = document.createElement('iframe');
    frame.setAttribute('data-magpie-survey', popup);
    frame.src = origin + '/s/' + popup + '?embed=1';
    frame.title = title;
    frame.style.cssText = 'width:100%;height:360px;border:0;display:block';
    // A survey that never answers (the site is down) is taken away again rather than left loading out of sight.
    var giveUp = setTimeout(function () { wrap.remove(); }, 60000);
    function onKey(e) { if (e.key === 'Escape') shut(); }
    function shut() { remember(popup); wrap.remove(); document.removeEventListener('keydown', onKey); }
    frame.__magpieShut = shut;
    frame.__magpieReveal = function () {
      frame.__magpieReveal = null;
      clearTimeout(giveUp);
      wrap.style.visibility = 'visible';
      wrap.style.pointerEvents = '';
      wrap.removeAttribute('aria-hidden');
      document.addEventListener('keydown', onKey);
      if (!slide) panel.focus();
    };
    close.addEventListener('click', shut);
    if (!slide) wrap.addEventListener('click', function (e) { if (e.target === wrap) shut(); });
    panel.appendChild(close);
    panel.appendChild(frame);
    wrap.appendChild(panel);
    document.body.appendChild(wrap);
  }

  setTimeout(function () {
    // With no delay, a script in the <head> can run before there's a body to add to.
    if (document.body) build();
    else document.addEventListener('DOMContentLoaded', build);
  }, delay * 1000);
})();
