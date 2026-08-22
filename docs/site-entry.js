const menuButton = document.querySelector('[data-menu-button]');
const mobileMenu = document.querySelector('[data-mobile-menu]');

const setMenuState = (open) => {
  if (!menuButton || !mobileMenu) return;
  menuButton.setAttribute('aria-expanded', String(open));
  mobileMenu.toggleAttribute('data-open', open);
  document.body.classList.toggle('menu-open', open);
};

menuButton?.addEventListener('click', () => {
  setMenuState(menuButton.getAttribute('aria-expanded') !== 'true');
});

mobileMenu?.querySelectorAll('a').forEach((link) => {
  link.addEventListener('click', () => setMenuState(false));
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') setMenuState(false);
});

document.addEventListener('click', (event) => {
  if (!mobileMenu || !menuButton || !mobileMenu.hasAttribute('data-open')) return;
  if (!(event.target instanceof Node)) return;
  if (!mobileMenu.contains(event.target) && !menuButton.contains(event.target)) setMenuState(false);
});

const copyText = async (value) => {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const textarea = document.createElement('textarea');
  textarea.value = value;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.append(textarea);
  textarea.select();
  document.execCommand('copy');
  textarea.remove();
};

document.querySelectorAll('[data-copy-code]').forEach((button) => {
  button.addEventListener('click', async () => {
    const block = button.closest('[data-code-block]');
    const code = block?.querySelector('code')?.textContent;
    if (!code) return;
    const originalLabel = button.textContent;
    try {
      await copyText(code);
      button.textContent = 'Copied';
      button.setAttribute('data-copied', 'true');
      window.setTimeout(() => {
        button.textContent = originalLabel;
        button.removeAttribute('data-copied');
      }, 1600);
    } catch {
      button.textContent = 'Select manually';
    }
  });
});

const currentPath = window.location.pathname;
document.querySelectorAll('[data-site-nav] a').forEach((link) => {
  const linkUrl = new URL(link.href, window.location.href);
  if (linkUrl.pathname === currentPath) link.setAttribute('aria-current', 'page');
});
