// Mobile nav toggle
const navToggle = document.getElementById('navToggle');
const mainNav = document.getElementById('main-nav');

if (navToggle && mainNav) {
  navToggle.addEventListener('click', () => {
    mainNav.classList.toggle('open');
  });

  mainNav.querySelectorAll('a').forEach(link => {
    link.addEventListener('click', () => mainNav.classList.remove('open'));
  });
}

// Hero slideshow (only present on pages with a hero carousel)
const slides = document.querySelectorAll('.hero-slide');
const prevBtn = document.getElementById('prevSlide');
const nextBtn = document.getElementById('nextSlide');
const pauseBtn = document.getElementById('pauseSlide');

if (slides.length && prevBtn && nextBtn && pauseBtn) {
  let current = 0;
  let playing = true;
  let timer;

  function showSlide(index) {
    slides[current].classList.remove('active');
    current = (index + slides.length) % slides.length;
    slides[current].classList.add('active');
  }

  function startTimer() {
    timer = setInterval(() => showSlide(current + 1), 5000);
  }

  function stopTimer() {
    clearInterval(timer);
  }

  startTimer();

  prevBtn.addEventListener('click', () => { showSlide(current - 1); stopTimer(); if (playing) startTimer(); });
  nextBtn.addEventListener('click', () => { showSlide(current + 1); stopTimer(); if (playing) startTimer(); });

  pauseBtn.addEventListener('click', () => {
    playing = !playing;
    pauseBtn.innerHTML = playing ? '&#10073;&#10073;' : '&#9654;';
    if (playing) startTimer(); else stopTimer();
  });
}

// Same-page anchor links (e.g. header/footer nav "#class", "#blog") rely on
// native browser hash-jump, which does nothing in the STUDIO embed context
// (see the scroll-polling note below) - so drive the scroll manually instead.
document.querySelectorAll('a[href^="#"]').forEach(link => {
  const href = link.getAttribute('href');
  if (href.length < 2) return;
  const target = document.querySelector(href);
  if (!target) return;
  link.addEventListener('click', e => {
    e.preventDefault();
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
});
// --- Language toggle buttons ("日本語" / "EN") ---
// 「日本語」ボタン → 日本語版 Home claude (page9)
// 「EN」ボタン    → 英語版 Home claude (メインページ)
const JP_HOME_URL = 'https://preview.studio.site/live/xPORlenzar/9';
const EN_HOME_URL = 'https://preview.studio.site/live/xPORlenzar';
document.querySelectorAll('.lang-toggle').forEach(link => {
  const label = link.textContent.trim().toLowerCase();
  const target = label.includes('日本') ? JP_HOME_URL : EN_HOME_URL;
  link.addEventListener('click', e => {
    e.preventDefault();
    window.location.href = target;
  });
});
// FAQ accordion
function toggleFaq(el) {
  const item = el.parentElement;
  const wasOpen = item.classList.contains('open');
  item.parentElement.querySelectorAll('.faq-item').forEach(i => i.classList.remove('open'));
  if (!wasOpen) item.classList.add('open');
}

// --- Scroll-position-driven effects ---
// Some embedding contexts (e.g. a page embedded as a large, non-scrolling
// iframe inside a scrolling parent page) never fire a 'scroll' event on this
// window, even though the content visibly scrolls past on screen. Everything
// below is driven by a polling loop instead of scroll/resize listeners so it
// keeps working in that situation.

const header = document.getElementById('header');
const revealSections = document.querySelectorAll('section');
revealSections.forEach(sec => sec.classList.add('reveal'));

const statNumbers = document.querySelectorAll('.stat-number');
const animatedStats = new Set();

function animateStat(el) {
  const target = parseInt(el.dataset.target, 10);
  const suffix = el.dataset.suffix || '';
  const duration = 1100;
  const start = performance.now();

  function tick(now) {
    const progress = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    el.textContent = Math.round(eased * target) + suffix;
    if (progress < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

const stickyCta = document.getElementById('stickyCta');
const scrollAnchor = document.querySelector('.hero') || header;

function checkScrollState() {
  if (header) {
    header.style.boxShadow = window.scrollY > 10
      ? '0 4px 16px rgba(0,0,0,0.1)'
      : '0 2px 10px rgba(0,0,0,0.06)';
  }

  revealSections.forEach(sec => {
    if (sec.classList.contains('in-view')) return;
    const rect = sec.getBoundingClientRect();
    if (rect.top < window.innerHeight * 0.85 && rect.bottom > 0) {
      sec.classList.add('in-view');
    }
  });

  statNumbers.forEach(el => {
    if (animatedStats.has(el)) return;
    const rect = el.getBoundingClientRect();
    if (rect.top < window.innerHeight * 0.92 && rect.bottom > 0) {
      animatedStats.add(el);
      animateStat(el);
    }
  });

  if (stickyCta && scrollAnchor) {
    const anchorBottom = scrollAnchor.getBoundingClientRect().bottom;
    stickyCta.classList.toggle('visible', anchorBottom < 0);
  }
}

window.addEventListener('scroll', checkScrollState, { passive: true });
window.addEventListener('resize', checkScrollState);
setInterval(checkScrollState, 250);
checkScrollState();
