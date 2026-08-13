// Apply dark mode class before first paint to prevent flash of wrong theme.
// Dark mode is the default - only skip if user explicitly chose light.
(function () {
  var theme = localStorage.getItem('overlap-theme')
  if (theme === 'light') return
  document.documentElement.classList.add('dark')
})()
