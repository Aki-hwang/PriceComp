/**
 * PriceComp - 의약품/건강기능식품 가격 비교 서버
 *
 * 검색 흐름:
 *  1. NAVER_CLIENT_ID / NAVER_CLIENT_SECRET 환경변수가 설정되어 있으면
 *     네이버 쇼핑 검색 API로 실시간 가격을 조회한다.
 *  2. 설정되어 있지 않으면 data/mock-products.json 의 데모 데이터로 응답한다.
 *
 * 모든 결과에는 판매처별 배송 정책(data/shipping-policies.json)을 적용해
 * "최종 결제가 = 판매가 + 배송비(무료배송 조건 충족 시 0원)" 를 계산해 준다.
 */
const express = require('express');
const session = require('express-session');
const fs = require('fs');
const path = require('path');
const store = require('./lib/store');

const app = express();
const PORT = process.env.PORT || 3000;

const shippingPolicies = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'data', 'shipping-policies.json'), 'utf-8')
);
const mockProducts = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'data', 'mock-products.json'), 'utf-8')
);

const isProd = process.env.NODE_ENV === 'production';
if (isProd) app.set('trust proxy', 1); // Railway 등 HTTPS 프록시 뒤에서 secure 쿠키 사용

app.use(express.json());
app.use(
  session({
    secret: process.env.APP_SECRET || 'dev-insecure-secret-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: isProd,
      maxAge: 1000 * 60 * 60 * 24 * 7,
    },
  })
);
app.use(express.static(path.join(__dirname, 'public')));

/* ------------------------------------------------------------ 인증 / 계정 */

/** 저장된 소스의 암호화 필드를 복호화해 클라이언트로 돌려줄 형태로 변환 */
function decodeSources(sources = []) {
  return sources.map((s) => ({
    name: s.name,
    id: store.decrypt(s.id),
    password: store.decrypt(s.password),
    key: store.decrypt(s.key),
  }));
}

/** 로그인 응답에 담을 사용자 전체 상태 */
function userPayload(username, u) {
  return {
    user: username,
    sources: decodeSources(u.sources),
    watchlist: u.watchlist || [],
    contributions: u.contributions || [],
  };
}

/** 현재 세션 사용자와 저장소를 함께 반환 (없으면 null) */
function currentUser(req) {
  if (!req.session.user) return null;
  const users = store.readUsers();
  const u = users[req.session.user];
  return u ? { users, u } : null;
}

function validateCreds(body) {
  const username = (body.username || '').trim();
  const password = body.password || '';
  if (username.length < 3) return '아이디는 3자 이상이어야 합니다.';
  if (!/^[a-zA-Z0-9_.-]+$/.test(username)) return '아이디는 영문/숫자/._- 만 사용할 수 있습니다.';
  if (password.length < 4) return '비밀번호는 4자 이상이어야 합니다.';
  return null;
}

app.post('/api/signup', (req, res) => {
  const err = validateCreds(req.body);
  if (err) return res.status(400).json({ error: err });
  const username = req.body.username.trim();
  const users = store.readUsers();
  if (users[username]) return res.status(409).json({ error: '이미 존재하는 아이디입니다.' });

  const { salt, hash } = store.hashPassword(req.body.password);
  users[username] = { salt, hash, sources: [], watchlist: [], contributions: [] };
  store.writeUsers(users);
  req.session.user = username;
  res.json(userPayload(username, users[username]));
});

app.post('/api/login', (req, res) => {
  const username = (req.body.username || '').trim();
  const users = store.readUsers();
  const u = users[username];
  if (!u || !store.verifyPassword(req.body.password || '', u.salt, u.hash)) {
    return res.status(401).json({ error: '아이디 또는 비밀번호가 올바르지 않습니다.' });
  }
  req.session.user = username;
  res.json(userPayload(username, u));
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/me', (req, res) => {
  const users = store.readUsers();
  const u = req.session.user && users[req.session.user];
  if (!u) return res.json({ user: null });
  res.json(userPayload(req.session.user, u));
});

app.put('/api/sources', (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: '로그인이 필요합니다.' });
  const users = store.readUsers();
  const u = users[req.session.user];
  if (!u) return res.status(401).json({ error: '세션이 만료되었습니다. 다시 로그인해 주세요.' });

  const incoming = Array.isArray(req.body.sources) ? req.body.sources : [];
  u.sources = incoming.slice(0, 20).map((s) => ({
    name: String(s.name || '').slice(0, 60),
    id: store.encrypt(String(s.id || '').slice(0, 200)),
    password: store.encrypt(String(s.password || '').slice(0, 200)),
    key: store.encrypt(String(s.key || '').slice(0, 400)),
  }));
  store.writeUsers(users);
  res.json({ sources: decodeSources(u.sources) });
});

/* ---------------------------------------------------- 관심 목록(장바구니) */

app.get('/api/watchlist', (req, res) => {
  const c = currentUser(req);
  if (!c) return res.status(401).json({ error: '로그인이 필요합니다.' });
  res.json({ watchlist: c.u.watchlist || [] });
});

app.post('/api/watchlist', (req, res) => {
  const c = currentUser(req);
  if (!c) return res.status(401).json({ error: '로그인이 필요합니다.' });
  const query = String(req.body.query || '').trim().slice(0, 100);
  if (!query) return res.status(400).json({ error: '검색어가 비어 있습니다.' });
  const list = c.u.watchlist || [];
  if (!list.includes(query)) list.unshift(query);
  c.u.watchlist = list.slice(0, 50);
  store.writeUsers(c.users);
  res.json({ watchlist: c.u.watchlist });
});

app.delete('/api/watchlist', (req, res) => {
  const c = currentUser(req);
  if (!c) return res.status(401).json({ error: '로그인이 필요합니다.' });
  const query = String(req.query.q || '');
  c.u.watchlist = (c.u.watchlist || []).filter((x) => x !== query);
  store.writeUsers(c.users);
  res.json({ watchlist: c.u.watchlist });
});

/* ------------------------------------------------ 담은 가격(북마클릿 기여) */

app.get('/api/contrib', (req, res) => {
  const c = currentUser(req);
  if (!c) return res.status(401).json({ error: '로그인이 필요합니다.' });
  res.json({ items: c.u.contributions || [] });
});

app.post('/api/contrib', (req, res) => {
  const c = currentUser(req);
  if (!c) return res.status(401).json({ error: '로그인이 필요합니다.' });
  const o = req.body.offer || {};
  const offer = {
    name: String(o.name || '').slice(0, 200),
    mallName: String(o.mallName || '').slice(0, 80),
    price: Math.max(0, Math.floor(Number(o.price) || 0)),
    link: String(o.link || '').slice(0, 500),
  };
  if (!offer.price) return res.status(400).json({ error: '유효한 가격이 아닙니다.' });
  c.u.contributions = [offer].concat(c.u.contributions || []).slice(0, 100);
  store.writeUsers(c.users);
  res.json({ items: c.u.contributions });
});

app.delete('/api/contrib', (req, res) => {
  const c = currentUser(req);
  if (!c) return res.status(401).json({ error: '로그인이 필요합니다.' });
  const i = Number(req.query.i);
  const list = c.u.contributions || [];
  if (Number.isInteger(i) && i >= 0 && i < list.length) {
    list.splice(i, 1);
    store.writeUsers(c.users);
  }
  res.json({ items: c.u.contributions || [] });
});

/** 판매처 이름으로 배송 정책을 찾는다. 등록되지 않은 판매처는 기본 정책을 쓴다. */
function getShippingPolicy(mallName) {
  return shippingPolicies.malls[mallName] || shippingPolicies.default;
}

/** 판매가에 배송 정책을 적용해 배송비/최종가/조건 설명을 붙인다. */
function applyShipping(offer) {
  const policy = offer.shippingOverride || getShippingPolicy(offer.mallName);
  const freeThreshold = policy.freeThreshold;
  const qualifiesFree =
    policy.fee === 0 || (freeThreshold != null && offer.price >= freeThreshold);
  const shippingFee = qualifiesFree ? 0 : policy.fee;

  let condition;
  if (policy.fee === 0) {
    condition = '전 상품 무료배송';
  } else if (freeThreshold != null) {
    condition = `${freeThreshold.toLocaleString('ko-KR')}원 이상 구매 시 무료배송`;
  } else {
    condition = '무료배송 조건 없음';
  }
  if (policy.note) condition += ` · ${policy.note}`;

  return {
    ...offer,
    shippingFee,
    freeShipping: shippingFee === 0,
    shippingCondition: condition,
    totalPrice: offer.price + shippingFee,
  };
}

/** HTML 태그 제거 (네이버 API 응답의 <b> 강조 태그 등) */
function stripTags(text) {
  return text.replace(/<[^>]*>/g, '');
}

/** 네이버 쇼핑 검색 API 호출 */
async function searchNaver(query) {
  const url =
    'https://openapi.naver.com/v1/search/shop.json?display=30&sort=asc&query=' +
    encodeURIComponent(query);
  const res = await fetch(url, {
    headers: {
      'X-Naver-Client-Id': process.env.NAVER_CLIENT_ID,
      'X-Naver-Client-Secret': process.env.NAVER_CLIENT_SECRET,
    },
  });
  if (!res.ok) {
    throw new Error(`네이버 API 오류: HTTP ${res.status}`);
  }
  const data = await res.json();
  return data.items.map((item) => ({
    name: stripTags(item.title),
    mallName: item.mallName || '판매처 미상',
    price: Number(item.lprice),
    link: item.link,
    image: item.image,
    brand: item.brand || item.maker || '',
  }));
}

/** 데모 데이터 검색: 공백을 무시하고 상품명/브랜드/키워드에 부분 일치 */
function searchMock(query) {
  const q = query.replace(/\s+/g, '').toLowerCase();
  const results = [];
  for (const product of mockProducts) {
    const haystack = [product.name, product.brand, ...(product.keywords || [])]
      .join(' ')
      .replace(/\s+/g, '')
      .toLowerCase();
    if (haystack.includes(q)) {
      for (const offer of product.offers) {
        results.push({
          name: `${product.brand} ${product.name} ${product.spec}`.trim(),
          mallName: offer.mallName,
          price: offer.price,
          link: offer.link || '#',
          image: product.image || '',
          brand: product.brand,
          shippingOverride: offer.shipping || null,
        });
      }
    }
  }
  return results;
}

app.get('/api/search', async (req, res) => {
  const query = (req.query.q || '').trim();
  if (!query) {
    return res.status(400).json({ error: '검색어를 입력해 주세요.' });
  }

  const useNaver = process.env.NAVER_CLIENT_ID && process.env.NAVER_CLIENT_SECRET;
  try {
    const rawOffers = useNaver ? await searchNaver(query) : searchMock(query);
    const offers = rawOffers
      .map(applyShipping)
      .map(({ shippingOverride, ...rest }) => rest)
      .sort((a, b) => a.totalPrice - b.totalPrice);

    res.json({
      query,
      source: useNaver ? 'naver' : 'demo',
      count: offers.length,
      offers,
    });
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: '가격 조회 중 오류가 발생했습니다: ' + err.message });
  }
});

app.listen(PORT, () => {
  const mode =
    process.env.NAVER_CLIENT_ID && process.env.NAVER_CLIENT_SECRET
      ? '네이버 쇼핑 API (실시간)'
      : '데모 데이터';
  console.log(`PriceComp 서버 실행 중: http://localhost:${PORT} [데이터 소스: ${mode}]`);
});
