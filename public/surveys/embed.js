/* MagpieCRM survey embeds. Pasted after a survey's iframe, it grows each
   iframe marked data-magpie-survey to fit the page of the survey it shows,
   as people move through it. With data-magpie-survey-popup on this script
   tag it shows the survey over the page instead, after data-delay seconds
   (8 if not set): data-mode="popup" in the middle, "slide" in the corner.
   Closing it or finishing the survey stops it showing again for 30 days.
   It only listens to the site it was loaded from. (Older embed codes carry
   the resizing inline and keep working.) */
(function () {
  var script = document.currentScript;
  if (!script) return;
  var origin = new URL(script.src).origin;

  if (!window.__magpieSurveys) {
    window.__magpieSurveys = true;
    window.addEventListener('message', function (e) {
      if (e.origin !== origin || !e.data || typeof e.data.id !== 'string') return;
      var id = e.data.id;
      if (e.data.type === 'em-survey:done') { remember(id); return; }
      if (e.data.type === 'em-survey:escape') {
        var open = document.querySelector('[data-magpie-survey-open="' + id + '"]');
        if (open && open.__shut) open.__shut();
        return;
      }
      if (e.data.type !== 'em-survey:height') return;
      var frames = document.querySelectorAll('iframe[data-magpie-survey]');
      for (var i = 0; i < frames.length; i++) {
        if (frames[i].getAttribute('data-magpie-survey') === id && frames[i].contentWindow === e.source) {
          frames[i].style.height = Math.max(200, Math.min(5000, Math.ceil(Number(e.data.height) || 0))) + 'px';
        }
      }
    });
  }

  function key(id) { return 'magpie-survey-popup:' + id; }
  function remember(id) { try { localStorage.setItem(key(id), String(Date.now())); } catch (err) {} }
  function seen(id) {
    try { var at = Number(localStorage.getItem(key(id))); return at && Date.now() - at < 30 * 864e5; } catch (err) { return false; }
  }

  var popup = script.getAttribute('data-magpie-survey-popup');
  if (!popup || !/^[\w-]{1,80}$/.test(popup) || seen(popup)) return;
  var slide = script.getAttribute('data-mode') === 'slide';
  var delay = Math.max(0, Math.min(120, Number(script.getAttribute('data-delay') || 8)));
  var title = script.getAttribute('data-title') || 'Survey';

  setTimeout(function () {
    var wrap = document.createElement('div');
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-modal', slide ? 'false' : 'true');
    wrap.setAttribute('aria-label', title);
    wrap.setAttribute('data-magpie-survey-open', popup);
    // On a narrow screen a slide-in is a sheet along the bottom; on a wide one it sits 24px in from the corner.
    var narrow = window.innerWidth < 640;
    wrap.style.cssText = slide
      ? (narrow ? 'position:fixed;left:0;right:0;bottom:0;z-index:2147483000' : 'position:fixed;right:24px;bottom:24px;z-index:2147483000;width:min(400px,calc(100vw - 48px))')
      : 'position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(17,19,22,.45)';
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
    function shut() { remember(popup); wrap.remove(); document.removeEventListener('keydown', onKey); }
    wrap.__shut = shut;
    function onKey(e) { if (e.key === 'Escape') shut(); }
    close.addEventListener('click', shut);
    if (!slide) wrap.addEventListener('click', function (e) { if (e.target === wrap) shut(); });
    document.addEventListener('keydown', onKey);
    panel.appendChild(close);
    panel.appendChild(frame);
    wrap.appendChild(panel);
    document.body.appendChild(wrap);
    if (!slide) panel.focus();
  }, delay * 1000);
})();
