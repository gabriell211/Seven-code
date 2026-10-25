/* Bundled inline, before async Code OSS modules. Prevents infinite loading screens. */
(function () {
  'use strict';
  const splash = document.getElementById('seven-code-loading');
  const message = document.getElementById('seven-loading-message');
  const retry = document.getElementById('seven-loading-retry');
  let state = 'loading';
  // This watchdog also covers bootstrap.js failing to load or import.
  const watchdog = setTimeout(
    () => fail('A inicialização demorou demais. Atualize o Android System WebView e tente novamente.'),
    65000
  );
  retry?.addEventListener('click', () => location.reload());
  function stage(text) {
    if (state === 'loading' && message) message.textContent = text;
  }
  function complete() {
    if (state !== 'loading') return;
    state = 'complete';
    clearTimeout(watchdog);
    splash?.classList.add('seven-hide');
    setTimeout(() => splash?.remove(), 480);
  }
  function fail(text) {
    if (state !== 'loading') return;
    state = 'error';
    clearTimeout(watchdog);
    splash?.classList.add('seven-error');
    splash?.setAttribute('role', 'alert');
    if (message) message.textContent = text;
  }
  globalThis.sevenLoading = { stage, complete, fail };
})();
