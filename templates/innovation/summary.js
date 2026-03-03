document.addEventListener('mousemove', function(e) {
  var tips = document.querySelectorAll('.card:hover > .card-tip, .card:hover > .card-tip-text');
  tips.forEach(function(tip) {
    var rect = tip.getBoundingClientRect();
    var w = rect.width || 375, h = rect.height || 275;
    var x = e.clientX + 12;
    var y = e.clientY + 12;
    if (x + w > window.innerWidth) x = e.clientX - w - 12;
    if (y + h > window.innerHeight) y = e.clientY - h - 12;
    if (x < 0) x = 4;
    if (y < 0) y = 4;
    tip.style.left = x + 'px';
    tip.style.top = y + 'px';
  });
});
document.querySelectorAll('.tri-toggle').forEach(function(toggle) {
  toggle.addEventListener('click', function(e) {
    var opt = e.target.closest('.tri-opt');
    if (!opt) return;
    var mode = opt.getAttribute('data-mode');
    var target = document.getElementById(toggle.getAttribute('data-target'));
    if (!target) return;
    toggle.querySelectorAll('.tri-opt').forEach(function(o) { o.classList.remove('active'); });
    opt.classList.add('active');
    if (mode === 'none') {
      target.style.display = 'none';
      target.classList.remove('mode-unknown');
    } else if (mode === 'all') {
      target.style.display = '';
      target.classList.remove('mode-unknown');
    } else if (mode === 'unknown') {
      target.style.display = '';
      target.classList.add('mode-unknown');
    } else if (mode === 'wide' || mode === 'tall') {
      var id = toggle.getAttribute('data-target');
      document.querySelectorAll('.layout-wide[data-list="'+id+'"]').forEach(function(el) {
        el.style.display = mode === 'wide' ? '' : 'none';
      });
      document.querySelectorAll('.layout-tall[data-list="'+id+'"]').forEach(function(el) {
        el.style.display = mode === 'tall' ? '' : 'none';
      });
    }
  });
});
