/* 手机目录抽屉（2026-10-27）：≤980px 替代隐藏的顶栏导航。
   只被打进全功能单文件版（build_single.py 的 UI 列表），Python 服务页不加载。 */
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  const drawer = $('#mnav');
  const mask = $('#mnavMask');
  const btn = $('#mnavBtn');
  if (!drawer || !mask || !btn) return;

  const links = $$('.mnav-group a[href^="#"]', drawer);
  const navLinks = $$('.nav a');
  const isOpen = () => drawer.classList.contains('on');

  /* 状态行：打开时现读控件值，避免和 app.js 的私有 state 耦合 */
  function paintStatus() {
    const loc = ($('#loc') && $('#loc').value.trim()) || '上海';
    const date = ($('#date') && $('#date').value) || '';
    const mode = ($('#mode button.on') && $('#mode button.on').textContent) || '晚霞';
    const el = $('#mnavStatus');
    if (el) el.textContent = loc + ' · ' + date.replace(/-/g, '.') + ' · ' + mode;
  }

  /* 抽屉与桌面顶栏共用一套高亮：按 href 精确匹配当前章节 */
  function setActive(href) {
    links.forEach(a => a.classList.toggle('active', a.getAttribute('href') === href));
    navLinks.forEach(a => a.classList.toggle('active', a.getAttribute('href') === href));
  }

  function open() {
    paintStatus();
    mask.classList.add('on');
    drawer.classList.add('on');
    btn.setAttribute('aria-expanded', 'true');
    document.body.classList.add('mnav-open');
    drawer.focus({ preventScroll: true });
  }

  function close() {
    mask.classList.remove('on');
    drawer.classList.remove('on');
    btn.setAttribute('aria-expanded', 'false');
    document.body.classList.remove('mnav-open');
    if (drawer.contains(document.activeElement)) btn.focus({ preventScroll: true });
  }

  btn.addEventListener('click', () => (isOpen() ? close() : open()));
  mask.addEventListener('click', close);
  drawer.addEventListener('click', e => {
    if (e.target.closest('a[href^="#"]')) close();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && isOpen()) close();
  });

  /* 滚动高亮：判定线取吸顶栏高度 + 24px，与 scroll-margin-top 同口径 */
  let raf = 0;
  function spy() {
    raf = 0;
    const top = $('.top');
    const line = (top ? top.getBoundingClientRect().height : 62) + 24;
    let cur = links.length ? links[0].getAttribute('href') : '';
    links.forEach(a => {
      const el = document.querySelector(a.getAttribute('href'));
      if (el && el.getBoundingClientRect().top <= line) cur = a.getAttribute('href');
    });
    setActive(cur);
  }
  const queue = () => {
    if (!raf) raf = requestAnimationFrame(spy);
  };
  window.addEventListener('scroll', queue, { passive: true });
  window.addEventListener('resize', () => {
    /* 拉宽到桌面档后汉堡消失，抽屉必须跟着收起，否则只剩遮罩挡住页面 */
    if (window.innerWidth > 980 && isOpen()) close();
    queue();
  });
  spy();
})();
