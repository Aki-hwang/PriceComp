'use strict';

const form = document.getElementById('search-form');
const input = document.getElementById('search-input');
const btn = document.getElementById('search-btn');
const statusEl = document.getElementById('status');
const resultsEl = document.getElementById('results');
const sourceBadge = document.getElementById('source-badge');

const won = (n) => n.toLocaleString('ko-KR') + '원';

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
  resultsEl.innerHTML = Array.from({ length: 3 })
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
    .map((o, i) => card(o, i === 0, o.totalPrice === cheapest))
    .join('');
}

function card(o, isFirst, isBest) {
  const ship = o.freeShipping
    ? '<span class="ship-free">무료배송</span>'
    : `<span class="ship-paid">배송비 ${won(o.shippingFee)}</span>`;

  const breakdown = o.freeShipping
    ? '배송비 포함'
    : `상품 ${won(o.price)} + 배송 ${won(o.shippingFee)}`;

  const link = o.link && o.link !== '#'
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

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

/* --------------------------------------------------------- 소스 설정 UI */
const sourcesList = document.getElementById('sources-list');
const DEFAULT_SOURCES = [{ name: '네이버 쇼핑', key: '' }];

function loadSources() {
  try {
    return JSON.parse(localStorage.getItem('pc-sources')) || DEFAULT_SOURCES;
  } catch {
    return DEFAULT_SOURCES;
  }
}
function saveSources(sources) {
  localStorage.setItem('pc-sources', JSON.stringify(sources));
}

function renderSources() {
  const sources = loadSources();
  sourcesList.innerHTML = '';
  sources.forEach((s, i) => {
    const row = document.createElement('div');
    row.className = 'source-row';
    row.innerHTML = `
      <input type="text" placeholder="소스 이름 (예: 네이버 쇼핑)" value="${escapeHtml(s.name)}" data-i="${i}" data-f="name" />
      <input type="text" placeholder="공개 검색 API 키 (선택)" value="${escapeHtml(s.key)}" data-i="${i}" data-f="key" />
      <button type="button" class="btn-remove" data-remove="${i}">삭제</button>`;
    sourcesList.appendChild(row);
  });
}

sourcesList.addEventListener('input', (e) => {
  const t = e.target;
  if (t.dataset.i == null) return;
  const sources = loadSources();
  sources[t.dataset.i][t.dataset.f] = t.value;
  saveSources(sources);
});
sourcesList.addEventListener('click', (e) => {
  if (e.target.dataset.remove == null) return;
  const sources = loadSources();
  sources.splice(Number(e.target.dataset.remove), 1);
  saveSources(sources);
  renderSources();
});
document.getElementById('add-source').addEventListener('click', () => {
  const sources = loadSources();
  sources.push({ name: '', key: '' });
  saveSources(sources);
  renderSources();
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

renderSources();
