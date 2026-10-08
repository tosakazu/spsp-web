// MathJax の設定 ($ … $ / $$ … $$)。details / math / eval で MathJax より前に読む (CSP のためインラインの <script> は使わない)
window.MathJax = {
  tex: { inlineMath: [['$', '$']], displayMath: [['$$', '$$']] },
  svg: { fontCache: 'global' }
};
