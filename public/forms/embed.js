/* MagpieCRM form embeds. Pasted with the form's iframe, it grows the iframe to
   fit the form and tells the form which page it's on. With data-magpie-popup
   on this script tag, it shows the form as a pop-up instead, after
   data-delay seconds (8 if not set), once: closing it or sending the form
   stops it showing again for 30 days. It only talks to the site it was
   loaded from. */
(function () {
  var script = document.currentScript;
  if (!script) return;
  var origin = new URL(script.src).origin;

  if (!window.__magpieForms) {
    window.__magpieForms = true;
    window.addEventListener('message', function (e) {
      if (e.origin !== origin || !e.data || typeof e.data.id !== 'string') return;
      var id = e.data.id;
      // The form asks which page it's on, so a submission can say where it came from.
      if (e.data.type === 'magpie-form:hello' && e.source) {
        e.source.postMessage({ type: 'magpie-form:page', id: id, url: location.href, referrer: document.referrer }, origin);
        return;
      }
      if (e.data.type === 'magpie-form:done') {
        remember(id);
        return;
      }
      // Escape pressed inside the form: a pop-up closes, as it does for Escape on the page.
      if (e.data.type === 'magpie-form:escape') {
        var open = document.querySelector('[data-magpie-popup-open="' + id + '"]');
        if (open && open.__shut) open.__shut();
        return;
      }
      if (e.data.type !== 'magpie-form:height') return;
      var frames = document.querySelectorAll('iframe[data-magpie-form]');
      for (var i = 0; i < frames.length; i++) {
        if (frames[i].getAttribute('data-magpie-form') === id) frames[i].style.height = Math.max(0, Math.min(5000, Number(e.data.height) || 0)) + 'px';
      }
    });
  }

  function key(id) { return 'magpie-form-popup:' + id; }
  function remember(id) { try { localStorage.setItem(key(id), String(Date.now())); } catch (err) {} }
  function seen(id) {
    try { var at = Number(localStorage.getItem(key(id))); return at && Date.now() - at < 30 * 864e5; } catch (err) { return false; }
  }

  var popup = script.getAttribute('data-magpie-popup');
  if (!popup || !/^[\w-]{1,80}$/.test(popup) || seen(popup)) return;
  var delay = Math.max(0, Math.min(120, Number(script.getAttribute('data-delay') || 8)));

  setTimeout(function () {
    var wrap = document.createElement('div');
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-modal', 'true');
    wrap.setAttribute('aria-label', script.getAttribute('data-title') || 'Form');
    wrap.style.cssText = 'position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(17,19,22,.45)';
    var panel = document.createElement('div');
    panel.style.cssText = 'position:relative;width:100%;max-width:480px;max-height:calc(100vh - 32px);overflow:auto;background:#fff;border-radius:14px;padding:28px 24px 20px;box-shadow:0 24px 64px -12px rgba(0,0,0,.35)';
    if (script.getAttribute('data-theme') === 'dark') panel.style.background = '#1d2025';
    var close = document.createElement('button');
    close.type = 'button';
    close.setAttribute('aria-label', 'Close');
    close.innerHTML = '&times;';
    close.style.cssText = 'position:absolute;top:8px;right:10px;width:36px;height:36px;border:0;border-radius:8px;background:transparent;font:24px/1 system-ui,sans-serif;color:#5b616e;cursor:pointer';
    var frame = document.createElement('iframe');
    frame.setAttribute('data-magpie-form', popup);
    frame.src = origin + '/f/' + popup + '?embed=1';
    frame.title = script.getAttribute('data-title') || 'Form';
    frame.style.cssText = 'width:100%;height:420px;border:0;display:block';
    function shut() { remember(popup); wrap.remove(); document.removeEventListener('keydown', onKey); }
    wrap.setAttribute('data-magpie-popup-open', popup);
    wrap.__shut = shut;
    function onKey(e) { if (e.key === 'Escape') shut(); }
    close.addEventListener('click', shut);
    wrap.addEventListener('click', function (e) { if (e.target === wrap) shut(); });
    document.addEventListener('keydown', onKey);
    panel.appendChild(close);
    panel.appendChild(frame);
    wrap.appendChild(panel);
    document.body.appendChild(wrap);
    close.focus();
  }, delay * 1000);
})();
