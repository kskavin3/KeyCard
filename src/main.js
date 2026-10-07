import { createPreview } from './demo.js';

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const mobileScreen = window.matchMedia('(max-width: 820px)');
const menuButton = document.querySelector('.menu-toggle');
const mobileNav = document.querySelector('.mobile-nav');

function closeMenu() {
  menuButton.setAttribute('aria-expanded', 'false');
  menuButton.setAttribute('aria-label', 'Open navigation');
  mobileNav.classList.remove('open');
  mobileNav.inert = true;
}

menuButton.addEventListener('click', () => {
  const opening = menuButton.getAttribute('aria-expanded') !== 'true';
  menuButton.setAttribute('aria-expanded', String(opening));
  menuButton.setAttribute('aria-label', opening ? 'Close navigation' : 'Open navigation');
  mobileNav.classList.toggle('open', opening);
  mobileNav.inert = !opening;
});
mobileNav.querySelectorAll('a').forEach(link => link.addEventListener('click', closeMenu));
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && menuButton.getAttribute('aria-expanded') === 'true') {
    closeMenu();
    menuButton.focus();
  }
});
document.addEventListener('click', event => {
  if (!event.target.closest('.site-header')) closeMenu();
});
mobileScreen.addEventListener('change', closeMenu);

if (!reducedMotion.matches && 'IntersectionObserver' in window) {
  document.body.classList.add('motion-ready');
  const revealObserver = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-visible');
        revealObserver.unobserve(entry.target);
      }
    });
  }, { threshold: 0.08 });
  document.querySelectorAll('.reveal').forEach(element => revealObserver.observe(element));
}

const storySteps = [...document.querySelectorAll('.story-step')];
const scenes = [...document.querySelectorAll('.flow-scene')];
const progressSegments = [...document.querySelectorAll('.flow-progress > span')];
const flowLabel = document.querySelector('.flow-progress small');
const storyLabels = ['01 — DISCOVER', '02 — AUTHORIZE', '03 — UNLOCK'];
const heroVisual = document.querySelector('.hero-visual');
const readingProgress = document.querySelector('.reading-progress');
const ctaStar = document.querySelector('.cta-star');
const storySticky = document.querySelector('.story-sticky');
let currentScene = -1;
let scrollQueued = false;

function updateScroll() {
  scrollQueued = false;
  const scrollable = document.documentElement.scrollHeight - window.innerHeight;
  readingProgress.style.transform = `scaleX(${scrollable > 0 ? window.scrollY / scrollable : 0})`;
  if (!reducedMotion.matches) {
    heroVisual.style.setProperty('--hero-drift', `${Math.min(window.scrollY * 0.1, 65)}px`);
    ctaStar.style.setProperty('--star-rotation', `${window.scrollY * 0.025}deg`);
  }
  const trigger = mobileScreen.matches
    ? Math.min(window.innerHeight * 0.84, storySticky.offsetHeight + 170)
    : window.innerHeight * 0.52;
  let active = 0;
  storySteps.forEach((step, index) => {
    if (step.getBoundingClientRect().top < trigger) active = index;
  });
  if (active !== currentScene) {
    currentScene = active;
    document.querySelector('.story-steps').classList.add('has-active');
    storySteps.forEach((step, index) => step.classList.toggle('active', index === active));
    scenes.forEach((scene, index) => { scene.hidden = index !== active; });
    progressSegments.forEach((segment, index) => segment.classList.toggle('active', index <= active));
    flowLabel.textContent = storyLabels[active];
  }
}

function queueScroll() {
  if (!scrollQueued) {
    scrollQueued = true;
    window.requestAnimationFrame(updateScroll);
  }
}
window.addEventListener('scroll', queueScroll, { passive: true });
window.addEventListener('resize', queueScroll);
reducedMotion.addEventListener('change', queueScroll);
updateScroll();

const apiSelect = document.querySelector('#api-select');
const modeButtons = [...document.querySelectorAll('[data-mode]')];
const runButton = document.querySelector('#run-demo');
const demoLog = document.querySelector('#demo-log');
const demoResponse = document.querySelector('#demo-response');
let mode = 'paid';
let running = false;
let toastTimer;

function showToast(message) {
  const toast = document.querySelector('#toast');
  toast.textContent = message;
  toast.classList.add('visible');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove('visible'), 3000);
}

function updatePreview() {
  const preview = createPreview(apiSelect.value, mode);
  document.querySelector('#demo-provider').textContent = preview.provider.name;
  document.querySelector('#demo-match').textContent = `Cheapest of ${preview.matchCount} matching services`;
  document.querySelector('#demo-price').textContent = `₳ ${preview.agentCost.toFixed(2)}`;
  document.querySelector('#demo-payer').textContent = 'Example total / call';
  modeButtons.forEach(button => {
    const active = button.dataset.mode === mode;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  demoResponse.hidden = true;
  const idle = document.createElement('span');
  idle.className = 'terminal-comment';
  idle.textContent = '› Ready when you are.';
  demoLog.replaceChildren(idle);
  runButton.firstChild.textContent = 'Run request ';
}

modeButtons.forEach(button => button.addEventListener('click', () => {
  if (running) return;
  mode = button.dataset.mode;
  updatePreview();
}));
apiSelect.addEventListener('change', updatePreview);
runButton.addEventListener('click', async () => {
  if (running) return;
  running = true;
  runButton.disabled = true;
  apiSelect.disabled = true;
  modeButtons.forEach(button => { button.disabled = true; });
  runButton.firstChild.textContent = 'Request in progress ';
  demoResponse.hidden = true;
  demoLog.replaceChildren();
  demoLog.setAttribute('aria-busy', 'true');
  const preview = createPreview(apiSelect.value, mode);
  try {
    for (const [index, text] of preview.steps.entries()) {
      if (!reducedMotion.matches) await new Promise(resolve => window.setTimeout(resolve, index === 0 ? 180 : 460));
      const line = document.createElement('div');
      line.className = 'log-line';
      const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      icon.classList.add('icon');
      icon.setAttribute('aria-hidden', 'true');
      const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
      use.setAttribute('href', '#icon-check');
      icon.append(use);
      line.append(icon, document.createTextNode(text));
      demoLog.append(line);
    }
    document.querySelector('#response-body').textContent = JSON.stringify(preview.response, null, 2);
    document.querySelector('#demo-receipt').textContent = 'Agent-funded · demo';
    demoResponse.hidden = false;
  } finally {
    running = false;
    runButton.disabled = false;
    apiSelect.disabled = false;
    modeButtons.forEach(button => { button.disabled = false; });
    runButton.firstChild.textContent = 'Run again ';
    demoLog.setAttribute('aria-busy', 'false');
  }
});

document.querySelector('#copy-request').addEventListener('click', async () => {
  const request = `GET /proxy/${apiSelect.value}\nAccept: application/json\n\nKeyCard concept preview — example request, not a live endpoint.`;
  try {
    await navigator.clipboard.writeText(request);
    showToast('Example request copied');
  } catch {
    showToast('Clipboard unavailable. Example: GET /proxy/' + apiSelect.value);
  }
});

document.querySelector('#year').textContent = new Date().getFullYear();
updatePreview();
