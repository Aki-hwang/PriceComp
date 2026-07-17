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
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

const shippingPolicies = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'data', 'shipping-policies.json'), 'utf-8')
);
const mockProducts = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'data', 'mock-products.json'), 'utf-8')
);

app.use(express.static(path.join(__dirname, 'public')));

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
