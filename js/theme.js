// theme.js — dark mode: follows system preference by default,
// a manual toggle overrides it (remembered per browser via localStorage).
// Include this BEFORE other scripts so the theme applies with no flash.
(function () {
  function applyTheme(theme) {
    if (theme === 'dark' || theme === 'light') {
      document.documentElement.setAttribute('data-theme', theme);
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
  }

  var saved = null;
  try { saved = localStorage.getItem('datify-theme'); } catch (e) {}
  applyTheme(saved);

  window.toggleDarkMode = function () {
    var current = document.documentElement.getAttribute('data-theme');
    var systemDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    var effectiveDark = current ? current === 'dark' : systemDark;
    var next = effectiveDark ? 'light' : 'dark';
    applyTheme(next);
    try { localStorage.setItem('datify-theme', next); } catch (e) {}
    updateThemeToggleIcons();
  };

  window.updateThemeToggleIcons = function () {
    var current = document.documentElement.getAttribute('data-theme');
    var systemDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    var effectiveDark = current ? current === 'dark' : systemDark;
    var name = effectiveDark ? 'sun' : 'moon';
    // This file loads in <head>, before js/icons.js, so fall back to the emoji
    // if the toggle is somehow painted before the icon set exists.
    var svg = window.icon ? window.icon(name, { size: 17 }) : '';
    document.querySelectorAll('.theme-toggle').forEach(function (btn) {
      btn.setAttribute('aria-label', effectiveDark ? 'Switch to light mode' : 'Switch to dark mode');
      if (svg) btn.innerHTML = svg;
      else btn.textContent = effectiveDark ? '☀' : '☾';
    });
  };

  document.addEventListener('DOMContentLoaded', function () {
    updateThemeToggleIcons();
  });
})();
