'use strict';

const form = document.getElementById('search-form');
const input = document.getElementById('search-input');
const btn = document.getElementById('search-btn');
const statusEl = document.getElementById('status');
const resultsEl = document.getElementById('results');
const sourceBadge = document.getElementById('source-badge');

const won = (n) => n.toLocaleString('ko-KR') + '원';

/** 앱 상태: 로그인 사용자와 소스 목록 */
const state = { user: null, sources: [] };

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

/* ------------------------------------------------------------------ 검색 */
async function search(query) {
  btn.disabled = true;
  statusEl.className = 'status';
  statusEl.textContent = `"${query}" 검색 중…`;
  showSkeleton();

  try {
    const res = await fetch('/api/search?q=' + encodeURIComponent(query));
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '검색에 실패했습니다.');
    render(data);
  } catch (err) {
    resultsEl.innerHTML = '';
    statusEl.className = 'status error';
    statusEl.textContent = err.message;
  } finally {
    btn.disabled = false;
  }
}

function showSkeleton() {
  resultsEl.innerHTML = Array.from({ length: 4 })
    .map(() => '<div class="skeleton"></div>')
    .join('');
}

function render(data) {
  sourceBadge.textContent = data.source === 'naver' ? '네이버 실시간' : '데모';

  if (!data.offers.length) {
    resultsEl.innerHTML = '';
    statusEl.className = 'status';
    statusEl.textContent = `"${data.query}"에 대한 결과가 없습니다. 다른 이름으로 검색해 보세요.`;
    return;
  }

  const cheapest = data.offers[0].totalPrice;
  statusEl.className = 'status';
  statusEl.textContent = `"${data.query}" · ${data.offers.length}개 판매처 · 최종가 낮은 순 정렬`;

  resultsEl.innerHTML = data.offers
    .map((o) => card(o, o.totalPrice === cheapest))
    .join('');
}

function card(o, isBest) {
  const ship = o.freeShipping
    ? '<span class="ship-free">무료배송</span>'
    : `<span class="ship-paid">배송비 ${won(o.shippingFee)}</span>`;

  const breakdown = o.freeShipping
    ? '배송비 포함'
    : `상품 ${won(o.price)} + 배송 ${won(o.shippingFee)}`;

  const link =
    o.link && o.link !== '#'
      ? `<a href="${o.link}" target="_blank" rel="noopener">${escapeHtml(o.name)}</a>`
      : escapeHtml(o.name);

  return `
    <div class="result-card${isBest ? ' best' : ''}">
      <div class="rc-main">
        ${isBest ? '<div class="best-tag">최저가</div>' : ''}
        <div class="rc-name">${link}</div>
        <div class="rc-meta"><span class="rc-mall">${escapeHtml(o.mallName)}</span></div>
        <div class="rc-ship">${ship} · <span class="ship-paid">${escapeHtml(o.shippingCondition)}</span></div>
      </div>
      <div class="rc-price">
        <div class="rc-total">${o.totalPrice.toLocaleString('ko-KR')}<span class="won">원</span></div>
        <div class="rc-breakdown">${breakdown}</div>
      </div>
    </div>`;
}

/* --------------------------------------------------------- 인증 / 계정 */
const authArea = document.getElementById('auth-area');
const authModal = document.getElementById('auth-modal');
const authForm = document.getElementById('auth-form');
const authUsername = document.getElementById('auth-username');
const authPassword = document.getElementById('auth-password');
const authError = document.getElementById('auth-error');
const authSubmit = document.getElementById('auth-submit');
let authMode = 'login';

function renderAuthArea() {
  if (state.user) {
    authArea.innerHTML = `
      <span class="auth-user">${escapeHtml(state.user)}</span>
      <button type="button" class="link-btn" id="logout-btn">로그아웃</button>`;
    document.getElementById('logout-btn').addEventListener('click', logout);
  } else {
    authArea.innerHTML = `<button type="button" class="btn-login" id="open-auth">로그인 / 회원가입</button>`;
    document.getElementById('open-auth').addEventListener('click', openAuth);
  }
}

function openAuth() {
  authError.textContent = '';
  authModal.hidden = false;
  authUsername.focus();
}
function closeAuth() {
  authModal.hidden = true;
  authForm.reset();
  authError.textContent = '';
}
function setAuthMode(mode) {
  authMode = mode;
  document.querySelectorAll('.modal-tabs button').forEach((b) =>
    b.classList.toggle('active', b.dataset.tab === mode)
  );
  authSubmit.textContent = mode === 'login' ? '로그인' : '회원가입';
  authPassword.autocomplete = mode === 'login' ? 'current-password' : 'new-password';
  authError.textContent = '';
}

document.querySelectorAll('.modal-tabs button').forEach((b) =>
  b.addEventListener('click', () => setAuthMode(b.dataset.tab))
);
document.getElementById('auth-close').addEventListener('click', closeAuth);
authModal.addEventListener('click', (e) => {
  if (e.target === authModal) closeAuth();
});

authForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  authError.textContent = '';
  authSubmit.disabled = true;
  try {
    const res = await fetch('/api/' + authMode, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: authUsername.value,
        password: authPassword.value,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '요청에 실패했습니다.');
    state.user = data.user;
    state.sources = data.sources && data.sources.length ? data.sources : defaultSources();
    closeAuth();
    renderAuthArea();
    renderSources();
    updateSourcesNote();
  } catch (err) {
    authError.textContent = err.message;
  } finally {
    authSubmit.disabled = false;
  }
});

async function logout() {
  await fetch('/api/logout', { method: 'POST' });
  state.user = null;
  state.sources = loadLocalSources();
  renderAuthArea();
  renderSources();
  updateSourcesNote();
}

async function loadMe() {
  try {
    const res = await fetch('/api/me');
    const data = await res.json();
    if (data.user) {
      state.user = data.user;
      state.sources = data.sources && data.sources.length ? data.sources : defaultSources();
    } else {
      state.user = null;
      state.sources = loadLocalSources();
    }
  } catch {
    state.sources = loadLocalSources();
  }
  renderAuthArea();
  renderSources();
  updateSourcesNote();
}

/* --------------------------------------------------------- 소스 설정 UI */
const sourcesList = document.getElementById('sources-list');
const saveBtn = document.getElementById('save-sources');
const saveState = document.getElementById('save-state');
const sourcesNote = document.getElementById('sources-note');

function defaultSources() {
  return [{ name: '네이버 쇼핑', id: '', password: '', key: '' }];
}
function loadLocalSources() {
  try {
    return JSON.parse(localStorage.getItem('pc-sources')) || defaultSources();
  } catch {
    return defaultSources();
  }
}
function persistLocal() {
  localStorage.setItem('pc-sources', JSON.stringify(state.sources));
}

function updateSourcesNote() {
  saveBtn.hidden = !state.user;
  if (state.user) {
    sourcesNote.innerHTML =
      '가격을 어디서 가져올지 설정합니다. 설정은 <strong>계정에 저장</strong>되어 다음에도 그대로 사용됩니다.';
  } else {
    sourcesNote.innerHTML =
      '가격을 어디서 가져올지 설정합니다. <strong>로그인하면 설정이 계정에 저장</strong>됩니다. (로그인 전에는 이 브라우저에만 임시 저장)';
  }
}

function renderSources() {
  sourcesList.innerHTML = '';
  state.sources.forEach((s, i) => {
    const row = document.createElement('div');
    row.className = 'source-row';
    row.innerHTML = `
      <input type="text" placeholder="소스 이름" value="${escapeHtml(s.name || '')}" data-i="${i}" data-f="name" />
      <input type="text" placeholder="아이디" value="${escapeHtml(s.id || '')}" data-i="${i}" data-f="id" autocomplete="off" />
      <input type="password" placeholder="비밀번호" value="${escapeHtml(s.password || '')}" data-i="${i}" data-f="password" autocomplete="new-password" />
      <input type="text" placeholder="API 키 (선택)" value="${escapeHtml(s.key || '')}" data-i="${i}" data-f="key" autocomplete="off" />
      <button type="button" class="btn-remove" data-remove="${i}">삭제</button>`;
    sourcesList.appendChild(row);
  });
}

function markDirty() {
  if (state.user) {
    saveState.textContent = '저장되지 않은 변경사항';
    saveState.className = 'save-state';
  } else {
    persistLocal();
  }
}

sourcesList.addEventListener('input', (e) => {
  const t = e.target;
  if (t.dataset.i == null) return;
  state.sources[t.dataset.i][t.dataset.f] = t.value;
  markDirty();
});
sourcesList.addEventListener('click', (e) => {
  if (e.target.dataset.remove == null) return;
  state.sources.splice(Number(e.target.dataset.remove), 1);
  renderSources();
  markDirty();
});
document.getElementById('add-source').addEventListener('click', () => {
  state.sources.push({ name: '', id: '', password: '', key: '' });
  renderSources();
  markDirty();
});

saveBtn.addEventListener('click', async () => {
  saveBtn.disabled = true;
  saveState.textContent = '저장 중…';
  saveState.className = 'save-state';
  try {
    const res = await fetch('/api/sources', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sources: state.sources }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '저장에 실패했습니다.');
    state.sources = data.sources;
    renderSources();
    saveState.textContent = '✓ 저장됨';
    saveState.className = 'save-state ok';
  } catch (err) {
    saveState.textContent = err.message;
    saveState.className = 'save-state';
  } finally {
    saveBtn.disabled = false;
  }
});

/* -------------------------------------------------------------- 이벤트 */
form.addEventListener('submit', (e) => {
  e.preventDefault();
  const q = input.value.trim();
  if (q) search(q);
});
document.querySelectorAll('.chip').forEach((chip) => {
  chip.addEventListener('click', () => {
    input.value = chip.dataset.q;
    search(chip.dataset.q);
  });
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !authModal.hidden) closeAuth();
});

setAuthMode('login');
loadMe();
