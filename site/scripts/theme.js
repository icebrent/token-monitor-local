/* theme.js: resolve/toggle/persist theme. Exposes window.TM_theme. */
(function () {
  var KEY = "token-monitor-site-theme";
  var root = document.documentElement;

  function stored() { try { return localStorage.getItem(KEY); } catch (e) { return null; } }
  function systemLight() { return !!(window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches); }
  function effective() {
    var s = stored();
    if (s === "light" || s === "dark") return s;
    return systemLight() ? "light" : "dark"; // matches CSS: dark unless OS explicitly light
  }
  function reflect() {
    var t = effective();
    var btn = document.querySelector("[data-theme-toggle]");
    if (btn) { btn.setAttribute("data-state", t); btn.setAttribute("aria-pressed", String(t === "light")); }
  }
  function set(t) { try { localStorage.setItem(KEY, t); } catch (e) {} root.setAttribute("data-theme", t); reflect(); }
  function toggle() { set(effective() === "dark" ? "light" : "dark"); }

  window.TM_theme = { effective: effective, toggle: toggle, reflect: reflect, set: set };
})();
