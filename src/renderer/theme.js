/*
 * Sets the theme class on <html> before the body paints, so there is no flash of
 * the wrong surface. The brand guide does this with an inline <script> in <head>;
 * inline scripts are blocked by this app's CSP, so it is a classic (non-module,
 * non-deferred) external script instead — which is equally render-blocking.
 *
 * Loaded before app.js and deliberately dependency-free.
 */
(function () {
  var root = document.documentElement;

  function systemTheme() {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  function apply(theme) {
    var resolved = theme === 'dark' || theme === 'light' ? theme : systemTheme();
    root.classList.toggle('dark', resolved === 'dark');
    root.classList.toggle('light', resolved === 'light');
    return resolved;
  }

  var stored = null;
  try {
    stored = localStorage.getItem('theme');
  } catch (err) {
    stored = null; // private mode, blocked storage — fall back to the OS
  }

  apply(stored);

  // Exposed for the toggle in app.js; kept on window because this file is not a module.
  window.__theme = {
    /** 'light' | 'dark' | null, where null means "follow the OS". */
    preference: function () {
      try {
        return localStorage.getItem('theme');
      } catch (err) {
        return null;
      }
    },
    resolved: function () {
      return root.classList.contains('dark') ? 'dark' : 'light';
    },
    set: function (theme) {
      try {
        if (theme) localStorage.setItem('theme', theme);
        else localStorage.removeItem('theme');
      } catch (err) {
        // Not persisting is survivable; the class still changes for this session.
      }
      return apply(theme);
    },
  };

  // Track the OS while no explicit preference is stored.
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () {
    if (!window.__theme.preference()) apply(null);
  });

  // Keep other windows of the app (the About window) in step with the toggle.
  window.addEventListener('storage', function (event) {
    if (event.key === 'theme') apply(event.newValue);
  });
})();
