// ブログのタブ (.tabs .tab → 直後の .tabpane を切り替える)。src/pages/blog.js が import する (以前は ranking-accuracy.html のインライン <script>、CSP のため 2026-10-25 に移動)
(function () {
  var tabs = document.querySelectorAll('.tabs .tab');
  tabs.forEach(function (b) {
    b.addEventListener('click', function () {
      var g = b.parentNode;
      g.querySelectorAll('.tab').forEach(function (x) { x.classList.remove('active'); });
      b.classList.add('active');
      var n = g.nextElementSibling;
      while (n && n.classList && n.classList.contains('tabpane')) { n.hidden = (n.id !== b.getAttribute('data-tab')); n = n.nextElementSibling; }
    });
  });
})();
