'use strict';

const form = document.getElementById('search-form');
const input = document.getElementById('search-input');
const btn = document.getElementById('search-btn');
const statusEl = document.getElementById('status');
const resultsEl = document.getElementById('results');
const resultsBar = document.getElementById('results-bar');
const resultsSummary = document.getElementById('results-summary');
const saveSearchBtn = document.getElementById('save-search');
const sourceBadge = document.getElementById('source-badge');

const won = (n) => n.toLocaleString('ko-KR') + '원';
const norm = (s) => String(s || '').replace(/\s+/g, '').toLowerCase();

/** 앱 상태 */
const state = { user: null, sources: [], watchlist: [], contributions: [] };
let activeQuery = '';

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

/* ------------------------------------------------------------------ 검색 */

/** 담은 가격 중 검색어와 일치하는 것을 오퍼 형태로 변환 */
function matchingContribs(query) {
  const q = norm(query);
  return state.contributions
    .filter((c) => norm(c.name).includes(q) || norm(c.mallName).includes(q))
    .map((c) => ({
      name: c.name,
      mallName: c.mallName,
      price: Number(c.price),
      link: c.link || '#',
      contributed: true,
      shippingFee: 0,
      freeShipping: false,
      shippingCondition: '직접 담은 가격 · 배송비 별도 확인',
      totalPrice: Number(c.price),
    }));
}

/** 서버 검색 결과 + 담은 가격을 합쳐 최종가 오름차순으로 반환 */
async function fetchOffers(query) {
  const res = await fetch('/api/search?q=' + encodeURIComponent(query));
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || '검색에 실패했습니다.');
  const offers = data.offers
    .concat(matchingContribs(query))
    .sort((a, b) => a.totalPrice - b.totalPrice);
  return { source: data.source, offers };
}

async function search(query) {
  query = query.trim();
  if (!query) return;
  input.value = query;
  activeQuery = query;
  btn.disabled = true;
  statusEl.className = 'status';
  statusEl.textContent = `"${query}" 검색 중…`;
  resultsBar.hidden = true;
  showSkeleton();

  try {
    const { source, offers } = await fetchOffers(query);
    render(query, source, offers);
  } catch (err) {
    resultsEl.innerHTML = '';
    resultsBar.hidden = true;
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

function render(query, source, offers) {
  sourceBadge.textContent = source === 'naver' ? '네이버 실시간' : '데모';

  if (!offers.length) {
    resultsEl.innerHTML = '';
    resultsBar.hidden = true;
    statusEl.className = 'status';
    statusEl.textContent = `"${query}"에 대한 결과가 없습니다. 다른 이름으로 검색해 보세요.`;
    return;
  }

  const cheapest = offers[0].totalPrice;
  statusEl.textContent = '';
  resultsBar.hidden = false;
  resultsSummary.textContent = `"${query}" · ${offers.length}개 · 최종가 낮은 순`;
  updateSaveBtn();

  resultsEl.innerHTML = offers.map((o) => card(o, o.totalPrice === cheapest)).join('');
}

// 결과 블럭 아무 곳이나 클릭하면 해당 링크로 이동 (내부 링크 클릭은 그대로 둠)
resultsEl.addEventListener('click', (e) => {
  if (e.target.closest('a')) return;
  const cardEl = e.target.closest('.result-card');
  if (cardEl && cardEl.dataset.href) window.open(cardEl.dataset.href, '_blank', 'noopener');
});

/** 판매처로 이동할 링크. 실제 링크가 없으면(데모) 상품명 검색으로 대체 */
function linkFor(o) {
  if (o.link && o.link !== '#') return o.link;
  return 'https://search.shopping.naver.com/search/all?query=' + encodeURIComponent(o.name);
}

function card(o, isBest) {
  const ship = o.freeShipping
    ? '<span class="ship-free">무료배송</span>'
    : `<span class="ship-paid">배송비 ${won(o.shippingFee)}</span>`;

  const breakdown = o.freeShipping
    ? '배송비 포함'
    : o.contributed
    ? '내가 담은 가격'
    : `상품 ${won(o.price)} + 배송 ${won(o.shippingFee)}`;

  const href = linkFor(o);
  const realLink = o.link && o.link !== '#';
  const goLabel = realLink ? '구매하러 가기' : '상품 검색';

  return `
    <div class="result-card${isBest ? ' best' : ''}" data-href="${href}" title="${escapeHtml(goLabel)}">
      <div class="rc-main">
        <div>
          ${isBest ? '<span class="best-tag">최저가</span>' : ''}
          ${o.contributed ? '<span class="best-tag contrib-tag">직접 담음</span>' : ''}
        </div>
        <div class="rc-name"><a href="${href}" target="_blank" rel="noopener">${escapeHtml(o.name)}</a></div>
        <div class="rc-meta"><span class="rc-mall">${escapeHtml(o.mallName)}</span></div>
        <div class="rc-ship">${ship} · <span class="ship-paid">${escapeHtml(o.shippingCondition)}</span></div>
      </div>
      <div class="rc-price">
        <div class="rc-total">${o.totalPrice.toLocaleString('ko-KR')}<span class="won">원</span></div>
        <div class="rc-breakdown">${breakdown}</div>
        <a class="go-btn" href="${href}" target="_blank" rel="noopener">${goLabel} <span class="go-arrow" aria-hidden="true">→</span></a>
      </div>
    </div>`;
}

/* --------------------------------------------------- 관심 목록(장바구니) */
const watchlistCard = document.getElementById('watchlist-card');
const watchlistEl = document.getElementById('watchlist');
const dashboardEl = document.getElementById('wl-dashboard');

function loadWatchlistLocal() {
  try {
    return JSON.parse(localStorage.getItem('pc-watchlist')) || [];
  } catch {
    return [];
  }
}
function persistWatchlistLocal() {
  localStorage.setItem('pc-watchlist', JSON.stringify(state.watchlist));
}

async function addToWatchlist(query) {
  query = query.trim();
  if (!query) return;
  if (state.user) {
    const res = await fetch('/api/watchlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
    });
    const d = await res.json();
    state.watchlist = d.watchlist || [];
  } else {
    if (!state.watchlist.includes(query)) state.watchlist.unshift(query);
    persistWatchlistLocal();
  }
  renderWatchlist();
  updateSaveBtn();
}

async function removeFromWatchlist(query) {
  if (state.user) {
    const res = await fetch('/api/watchlist?q=' + encodeURIComponent(query), { method: 'DELETE' });
    const d = await res.json();
    state.watchlist = d.watchlist || [];
  } else {
    state.watchlist = state.watchlist.filter((x) => x !== query);
    persistWatchlistLocal();
  }
  renderWatchlist();
  updateSaveBtn();
}

function updateSaveBtn() {
  if (!activeQuery) return;
  const saved = state.watchlist.includes(activeQuery);
  saveSearchBtn.textContent = saved ? '★ 관심 목록에 있음' : '☆ 관심에 추가';
  saveSearchBtn.classList.toggle('active', saved);
}

function renderWatchlist() {
  watchlistCard.hidden = state.watchlist.length === 0;
  watchlistEl.innerHTML = state.watchlist
    .map(
      (q) => `
      <span class="wl-item">
        <button class="wl-q" data-q="${escapeHtml(q)}">${escapeHtml(q)}</button>
        <button class="wl-x" data-x="${escapeHtml(q)}" title="삭제">✕</button>
      </span>`
    )
    .join('');
  dashboardEl.innerHTML = '';
}

async function checkAll() {
  if (!state.watchlist.length) return;
  dashboardEl.innerHTML = '<div class="wl-row muted">전체 최저가 확인 중…</div>';
  const rows = [];
  for (const q of state.watchlist) {
    try {
      const { offers } = await fetchOffers(q);
      if (offers.length) {
        const b = offers[0];
        rows.push(
          `<button class="wl-row" data-q="${escapeHtml(q)}"><span class="wl-row-q">${escapeHtml(
            q
          )}</span><span class="wl-row-price"><strong>${won(b.totalPrice)}</strong> · ${escapeHtml(
            b.mallName
          )}</span></button>`
        );
      } else {
        rows.push(
          `<button class="wl-row" data-q="${escapeHtml(q)}"><span class="wl-row-q">${escapeHtml(
            q
          )}</span><span class="wl-row-price muted">결과 없음</span></button>`
        );
      }
    } catch {
      rows.push(
        `<div class="wl-row muted"><span class="wl-row-q">${escapeHtml(
          q
        )}</span><span class="wl-row-price">오류</span></div>`
      );
    }
  }
  dashboardEl.innerHTML = rows.join('');
}

watchlistEl.addEventListener('click', (e) => {
  const q = e.target.dataset.q;
  const x = e.target.dataset.x;
  if (q != null) search(q);
  else if (x != null) removeFromWatchlist(x);
});
dashboardEl.addEventListener('click', (e) => {
  const row = e.target.closest('.wl-row');
  if (row && row.dataset.q) {
    search(row.dataset.q);
    resultsEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
});
document.getElementById('check-all').addEventListener('click', checkAll);
saveSearchBtn.addEventListener('click', () => {
  if (!activeQuery) return;
  if (state.watchlist.includes(activeQuery)) removeFromWatchlist(activeQuery);
  else addToWatchlist(activeQuery);
});

/* --------------------------------------------- 담은 가격 (북마클릿 기여) */
const contribListEl = document.getElementById('contrib-list');
const contribCountEl = document.getElementById('contrib-count');

function loadContribLocal() {
  try {
    return JSON.parse(localStorage.getItem('pc-contrib')) || [];
  } catch {
    return [];
  }
}
function persistContribLocal() {
  localStorage.setItem('pc-contrib', JSON.stringify(state.contributions));
}

function renderContrib() {
  contribCountEl.textContent = state.contributions.length;
  contribListEl.innerHTML =
    state.contributions
      .map(
        (c, i) => `
      <div class="contrib-item">
        <div class="ci-main">
          <span class="rc-mall">${escapeHtml(c.mallName)}</span>
          <span class="ci-name">${escapeHtml(c.name)}</span>
        </div>
        <div class="ci-price">${Number(c.price).toLocaleString('ko-KR')}원
          <button class="btn-remove" data-ci="${i}">삭제</button>
        </div>
      </div>`
      )
      .join('') || '<div class="contrib-empty">아직 담은 가격이 없습니다.</div>';
}

async function addContribution(data) {
  const offer = {
    name: String(data.name || '').trim(),
    mallName: String(data.mallName || '').trim(),
    price: Math.floor(Number(data.price) || 0),
    link: data.link || '#',
  };
  if (!offer.price) {
    toast('가격을 인식하지 못했습니다.');
    return;
  }
  if (state.user) {
    const res = await fetch('/api/contrib', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ offer }),
    });
    const d = await res.json();
    state.contributions = d.items || [];
  } else {
    state.contributions.unshift(offer);
    persistContribLocal();
  }
  renderContrib();
  toast(`“${offer.mallName}”의 가격 ${won(offer.price)}을 담았어요.`);
}

async function removeContribution(i) {
  if (state.user) {
    const res = await fetch('/api/contrib?i=' + i, { method: 'DELETE' });
    const d = await res.json();
    state.contributions = d.items || [];
  } else {
    state.contributions.splice(i, 1);
    persistContribLocal();
  }
  renderContrib();
}

contribListEl.addEventListener('click', (e) => {
  if (e.target.dataset.ci != null) removeContribution(Number(e.target.dataset.ci));
});

function toast(msg) {
  statusEl.className = 'status';
  statusEl.textContent = msg;
}

/* 북마클릿: 현재 페이지(로그인된 본인 브라우저)에서 가격만 읽어 PriceComp로 전달 */
function buildBookmarklet() {
  const code =
    "javascript:(function(){function g(){try{var L=document.querySelectorAll('script[type=\"application/ld+json\"]');for(var i=0;i<L.length;i++){var d=JSON.parse(L[i].textContent);var a=Array.isArray(d)?d:[d];for(var j=0;j<a.length;j++){var o=a[j].offers;var f=o&&(Array.isArray(o)?o[0]:o);if(f&&f.price)return Number(f.price);}}}catch(e){}var m=document.querySelector('meta[property=\"product:price:amount\"],meta[property=\"og:price:amount\"]');if(m&&m.content)return Number(m.content);return null;}var p=g();if(p==null){var s=(''+window.getSelection()).replace(/[^0-9]/g,'');if(s)p=Number(s);}if(p==null){var t=prompt('가격을 자동으로 못 찾았어요. 가격 숫자만 입력(원):');if(!t)return;p=Number((''+t).replace(/[^0-9]/g,''));}if(!p){alert('가격을 인식하지 못했어요.');return;}var n=(document.querySelector('meta[property=\"og:title\"]')||{}).content||document.title;var mall=location.hostname.replace(/^www\\./,'');var data={name:n,mallName:mall,price:p,link:location.href};var u='__ORIGIN__/#add='+encodeURIComponent(btoa(unescape(encodeURIComponent(JSON.stringify(data)))));window.open(u,'_blank');})();";
  return code.replace('__ORIGIN__', location.origin);
}

function ingestHash() {
  const m = location.hash.match(/[#&]add=([^&]+)/);
  if (!m) return;
  try {
    const json = decodeURIComponent(escape(atob(decodeURIComponent(m[1]))));
    addContribution(JSON.parse(json));
    document.querySelectorAll('.sources-panel')[1]?.setAttribute('open', '');
  } catch {
    toast('담은 가격을 읽지 못했습니다.');
  }
  history.replaceState(null, '', location.pathname);
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

function applyPayload(data) {
  state.user = data.user;
  state.sources = data.sources && data.sources.length ? data.sources : defaultSources();
  state.watchlist = data.watchlist || [];
  state.contributions = data.contributions || [];
}

authForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  authError.textContent = '';
  authSubmit.disabled = true;
  try {
    const res = await fetch('/api/' + authMode, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: authUsername.value, password: authPassword.value }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '요청에 실패했습니다.');
    applyPayload(data);
    closeAuth();
    renderAll();
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
  state.watchlist = loadWatchlistLocal();
  state.contributions = loadContribLocal();
  renderAll();
}

async function loadMe() {
  try {
    const res = await fetch('/api/me');
    const data = await res.json();
    if (data.user) {
      applyPayload(data);
    } else {
      state.user = null;
      state.sources = loadLocalSources();
      state.watchlist = loadWatchlistLocal();
      state.contributions = loadContribLocal();
    }
  } catch {
    state.sources = loadLocalSources();
    state.watchlist = loadWatchlistLocal();
    state.contributions = loadContribLocal();
  }
  renderAll();
  ingestHash();
}

function renderAll() {
  renderAuthArea();
  renderSources();
  renderWatchlist();
  renderContrib();
  updateSourcesNote();
  updateSaveBtn();
}

/* --------------------------------------------------------- 소스 설정 UI */
const sourcesList = document.getElementById('sources-list');
const saveBtn = document.getElementById('save-sources');
const saveState = document.getElementById('save-state');
const sourcesNote = document.getElementById('sources-note');

function defaultSources() {
  return [{ name: '네이버 쇼핑', key: '' }];
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
      <input type="text" placeholder="소스 이름 (예: 네이버 쇼핑)" value="${escapeHtml(s.name || '')}" data-i="${i}" data-f="name" />
      <input type="text" placeholder="공개 API 키 (선택)" value="${escapeHtml(s.key || '')}" data-i="${i}" data-f="key" autocomplete="off" />
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
  state.sources.push({ name: '', key: '' });
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
  search(input.value);
});
document.querySelectorAll('.chip').forEach((chip) => {
  chip.addEventListener('click', () => search(chip.dataset.q));
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !authModal.hidden) closeAuth();
});
window.addEventListener('hashchange', ingestHash);

document.getElementById('bookmarklet').setAttribute('href', buildBookmarklet());
setAuthMode('login');
loadMe();
