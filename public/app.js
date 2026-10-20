// Confirmation prompt for forms with data-confirm="..."
document.addEventListener('submit', function (e) {
  var msg = e.target.getAttribute('data-confirm');
  if (msg && !window.confirm(msg)) e.preventDefault();
});

// Close the Login dropdown when clicking elsewhere or pressing Escape
document.addEventListener('click', function (e) {
  document.querySelectorAll('details.dropdown[open]').forEach(function (d) {
    if (!d.contains(e.target)) d.removeAttribute('open');
  });
});
document.addEventListener('keydown', function (e) {
  if (e.key === 'Escape') {
    document.querySelectorAll('details.dropdown[open]').forEach(function (d) { d.removeAttribute('open'); });
  }
});
