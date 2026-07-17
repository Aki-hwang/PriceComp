/**
 * URL에서 가격을 추출하는 모듈.
 *
 * 공개된 상품 페이지의 HTML을 받아 JSON-LD / 오픈그래프 메타태그 / 흔한 가격 표기에서
 * 가격을 뽑아냅니다. 로그인이 필요한 페이지는 서버가 볼 수 없으므로 추출되지 않습니다.
 *
 * 보안: 사용자가 넣은 임의 URL을 서버가 대신 요청하므로 SSRF를 방지하기 위해
 * 내부/사설 IP로 향하는 요청을 차단합니다.
 */
const dns = require('dns').promises;
const net = require('net');

function toNum(s) {
  const n = Number(String(s).replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

function decodeEntities(s) {
  return String(s)
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const p = ip.split('.').map(Number);
    return (
      p[0] === 10 ||
      p[0] === 127 ||
      p[0] === 0 ||
      (p[0] === 192 && p[1] === 168) ||
      (p[0] === 172 && p[1] >= 16 && p[1] <= 31) ||
      (p[0] === 169 && p[1] === 254)
    );
  }
  const l = ip.toLowerCase();
  return l === '::1' || l === '::' || l.startsWith('fc') || l.startsWith('fd') || l.startsWith('fe80');
}

/** URL이 공개 주소인지 검증하고 URL 객체를 반환 (아니면 throw) */
async function assertPublicUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('올바른 URL이 아닙니다.');
  }
  if (!/^https?:$/.test(url.protocol)) throw new Error('http/https 주소만 지원합니다.');
  if (url.hostname === 'localhost') throw new Error('허용되지 않는 주소입니다.');

  let addrs;
  try {
    addrs = await dns.lookup(url.hostname, { all: true });
  } catch {
    throw new Error('주소를 확인할 수 없습니다.');
  }
  if (addrs.some((a) => isPrivateIp(a.address))) {
    throw new Error('내부 주소는 조회할 수 없습니다.');
  }
  return url;
}

/** HTML 문자열에서 가격 추출 (없으면 null) */
function extractPrice(html) {
  // 1) JSON-LD (schema.org Product/Offer)
  const scripts = html.matchAll(
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  );
  for (const m of scripts) {
    try {
      const data = JSON.parse(m[1].trim());
      const price = findOfferPrice(data);
      if (price) return price;
    } catch {
      /* JSON 파싱 실패는 무시 */
    }
  }
  // 2) 오픈그래프/상품 메타태그
  const meta =
    html.match(
      /<meta[^>]+(?:property|name)=["'](?:product:price:amount|og:price:amount)["'][^>]+content=["']([^"']+)["']/i
    ) ||
    html.match(
      /<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["'](?:product:price:amount|og:price:amount)["']/i
    );
  if (meta) {
    const n = toNum(meta[1]);
    if (n) return n;
  }
  return null;
}

/** JSON-LD 노드(배열/객체/@graph)에서 offers.price 탐색 */
function findOfferPrice(node) {
  if (!node || typeof node !== 'object') return null;
  const list = Array.isArray(node) ? node : node['@graph'] ? node['@graph'] : [node];
  for (const o of list) {
    if (!o || typeof o !== 'object') continue;
    if (o.offers) {
      const off = Array.isArray(o.offers) ? o.offers[0] : o.offers;
      if (off && (off.price || off.lowPrice)) {
        const n = toNum(off.price || off.lowPrice);
        if (n) return n;
      }
    }
    if (o.price) {
      const n = toNum(o.price);
      if (n) return n;
    }
  }
  return null;
}

/** HTML에서 상품명(제목) 추출 */
function extractTitle(html) {
  const og = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
  if (og) return decodeEntities(og[1]).trim();
  const t = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (t) return decodeEntities(t[1]).replace(/\s+/g, ' ').trim();
  return null;
}

/** URL을 받아 { price, name, mallName, link } 반환. price는 못 찾으면 null */
async function fetchPrice(raw) {
  const url = await assertPublicUrl(raw);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  let res;
  try {
    res = await fetch(url.href, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; PriceCompBot/1.0)',
        Accept: 'text/html,application/xhtml+xml',
      },
    });
  } catch (e) {
    throw new Error(e.name === 'AbortError' ? '응답 시간이 초과되었습니다.' : '페이지를 불러오지 못했습니다.');
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new Error('페이지 응답 오류 (HTTP ' + res.status + ')');

  const html = (await res.text()).slice(0, 2_000_000);
  return {
    price: extractPrice(html),
    name: extractTitle(html) || url.hostname,
    mallName: url.hostname.replace(/^www\./, ''),
    link: url.href,
  };
}

module.exports = { fetchPrice, extractPrice, extractTitle, assertPublicUrl };
