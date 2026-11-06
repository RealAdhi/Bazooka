// The one header used on every page: logo, Capture | Board (| Admin) toggle, and on the right
// the signed-in person (avatar + name). Tapping it opens their profile, Admin (admins) and Sign out.
import { auth } from './data.js';

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const initials = (n) => String(n || '?').trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();

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
      <button class="profile-btn" id="profileBtn" type="button" aria-haspopup="dialog" aria-expanded="false" aria-controls="profileMenu">
        <span class="avatar" aria-hidden="true">${esc(initials(me?.full_name))}</span><span class="pname">${esc(me?.full_name || 'Account')}</span>
      </button>
      <div class="menu" id="profileMenu" role="dialog" aria-label="Profile and settings" hidden>
        <section class="profile">
          <span class="avatar lg" aria-hidden="true">${esc(initials(me?.full_name))}</span>
          <div><p class="p-n">${esc(me?.full_name || '')}</p><p class="p-e">${esc(me?.email || '')}</p>
            <p class="p-r">${isAdmin ? 'Admin' : 'Member'}</p></div>
        </section>
        ${isAdmin ? '<a href="/admin.html">Admin settings</a>' : ''}
        <button type="button" data-signout>Sign out</button>
      </div>
    </div>
  </div>`;
  const btn = el.querySelector('#profileBtn'), menu = el.querySelector('#profileMenu');
  if (btn) {
    const close = () => { menu.hidden = true; btn.setAttribute('aria-expanded', 'false'); };
    btn.addEventListener('click', (e) => { e.stopPropagation(); const open = menu.hidden; menu.hidden = !open; btn.setAttribute('aria-expanded', String(open)); if (open) menu.querySelector('a, button')?.focus(); });
    document.addEventListener('click', (e) => { if (!menu.contains(e.target)) close(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !menu.hidden) { close(); btn.focus(); } });
  }
  el.querySelectorAll('[data-signout]').forEach((b) => b.addEventListener('click', async () => { await auth.signOut(); location.replace('/login.html'); }));
}
