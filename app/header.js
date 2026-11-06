// The one header used on every page: logo, Capture | Board (| Admin) toggle, and on the right
// a settings menu (admins) or Sign out (everyone else).
import { auth } from './data.js';

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const GEAR = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>';

export function logoHTML() {
  return '<a class="logo" href="/" aria-label="Bazooka 2.0, go to the board"><b>Bazooka</b><span class="ver">2.0</span></a>';
}

// current: 'capture' | 'board' | 'admin'
export function mountHeader(me, current) {
  const el = document.getElementById('appbar');
  const isAdmin = me?.role === 'admin';
  const tabs = [['capture', 'Capture', '/capture.html'], ['board', 'Board', '/'], ...(isAdmin ? [['admin', 'Admin', '/admin.html']] : [])];
  el.className = 'appbar';
  el.innerHTML = `<div class="appbar-in">
    ${logoHTML()}
    <nav class="seg" aria-label="Pages">${tabs.map(([k, label, href]) =>
      `<a href="${href}"${k === current ? ' aria-current="page"' : ''}>${label}</a>`).join('')}</nav>
    <div class="appbar-end">
      ${isAdmin
        ? `<button class="icon-btn" id="settingsBtn" type="button" aria-haspopup="menu" aria-expanded="false" aria-label="Settings">${GEAR}</button>
           <div class="menu" id="settingsMenu" role="menu" hidden>
             <p class="menu-who">${esc(me.full_name)}</p>
             <a role="menuitem" href="/admin.html">Admin</a>
             <button role="menuitem" type="button" data-signout>Sign out</button>
           </div>`
        : `<button class="btn btn-quiet signout" type="button" data-signout>Sign out</button>`}
    </div>
  </div>`;
  const btn = el.querySelector('#settingsBtn'), menu = el.querySelector('#settingsMenu');
  if (btn) {
    const close = () => { menu.hidden = true; btn.setAttribute('aria-expanded', 'false'); };
    btn.addEventListener('click', (e) => { e.stopPropagation(); const open = menu.hidden; menu.hidden = !open; btn.setAttribute('aria-expanded', String(open)); if (open) menu.querySelector('[role=menuitem]').focus(); });
    document.addEventListener('click', (e) => { if (!menu.contains(e.target)) close(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !menu.hidden) { close(); btn.focus(); } });
  }
  el.querySelectorAll('[data-signout]').forEach((b) => b.addEventListener('click', async () => { await auth.signOut(); location.replace('/login.html'); }));
}
