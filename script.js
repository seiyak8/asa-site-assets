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

// Header shadow on scroll
const header = document.getElementById('header');
if (header) {
  window.addEventListener('scroll', () => {
    header.style.boxShadow = window.scrollY > 10
      ? '0 4px 16px rgba(0,0,0,0.1)'
      : '0 2px 10px rgba(0,0,0,0.06)';
  });
}

// FAQ accordion
function toggleFaq(el) {
  const item = el.parentElement;
  const wasOpen = item.classList.contains('open');
  item.parentElement.querySelectorAll('.faq-item').forEach(i => i.classList.remove('open'));
  if (!wasOpen) item.classList.add('open');
}

// Section reveal animations
const revealSections = document.querySelectorAll('section');
if (revealSections.length && 'IntersectionObserver' in window) {
  const revealObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('in-view');
        revealObserver.unobserve(entry.target);
      }
    });
  }, { threshold: 0.15, rootMargin: '0px 0px -60px 0px' });

  revealSections.forEach(sec => {
    sec.classList.add('reveal');
    revealObserver.observe(sec);
  });
}

// Stat counters: count up from 0 to data-target once scrolled into view
const statNumbers = document.querySelectorAll('.stat-number');
if (statNumbers.length) {
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

  function checkStats() {
    statNumbers.forEach(el => {
      if (animatedStats.has(el)) return;
      const rect = el.getBoundingClientRect();
      if (rect.top < window.innerHeight * 0.92 && rect.bottom > 0) {
        animatedStats.add(el);
        animateStat(el);
      }
    });
  }

  window.addEventListener('scroll', checkStats, { passive: true });
  window.addEventListener('resize', checkStats);
  checkStats();
}

// Sticky mobile CTA: show once the hero (or, if none, the header) is scrolled past
const stickyCta = document.getElementById('stickyCta');
const scrollAnchor = document.querySelector('.hero') || header;
if (stickyCta && scrollAnchor) {
  window.addEventListener('scroll', () => {
    const anchorBottom = scrollAnchor.getBoundingClientRect().bottom;
    stickyCta.classList.toggle('visible', anchorBottom < 0);
  });
}
