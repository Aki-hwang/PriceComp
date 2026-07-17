/**
 * 사용자 저장소 + 암호화 유틸
 *
 * - 계정 비밀번호: scrypt 해시로 저장 (원문 저장 안 함, 복호화 불가)
 * - 소스 비밀 정보(쇼핑몰 아이디/비번/API키): AES-256-GCM으로 암호화해 저장
 *   → 저장 파일이 유출돼도 APP_SECRET 없이는 읽을 수 없음. 본인 로그인 시에만 복호화.
 *
 * 데모 편의를 위해 파일(data/users.json)에 저장합니다. 운영에서는 DB로 교체하세요.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const USERS_FILE = path.join(__dirname, '..', 'data', 'users.json');

const SECRET = process.env.APP_SECRET || 'dev-insecure-secret-change-me';
if (!process.env.APP_SECRET) {
  console.warn(
    '⚠️  APP_SECRET 미설정: 개발용 기본 키를 사용합니다. 운영 환경에서는 반드시 설정하세요.'
  );
}
const ENC_KEY = crypto.scryptSync(SECRET, 'pricecomp-enc-salt', 32);

function readUsers() {
  try {
    return JSON.parse(fs.readFileSync(USERS_FILE, 'utf-8'));
  } catch {
    return {};
  }
}

function writeUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

/** 비밀번호 해시 생성 (scrypt). salt 미지정 시 새로 생성. */
function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { salt, hash };
}

/** 저장된 salt/hash 로 비밀번호 검증 (타이밍 공격 방지) */
function verifyPassword(password, salt, hash) {
  const test = crypto.scryptSync(password, salt, 64);
  const stored = Buffer.from(hash, 'hex');
  return test.length === stored.length && crypto.timingSafeEqual(test, stored);
}

/** 문자열 암호화 → base64(iv|tag|ciphertext) */
function encrypt(text) {
  if (!text) return '';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', ENC_KEY, iv);
  const enc = Buffer.concat([cipher.update(String(text), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

/** encrypt() 역연산. 복호화 실패 시 빈 문자열. */
function decrypt(blob) {
  if (!blob) return '';
  try {
    const raw = Buffer.from(blob, 'base64');
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const enc = raw.subarray(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', ENC_KEY, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
  } catch {
    return '';
  }
}

module.exports = { readUsers, writeUsers, hashPassword, verifyPassword, encrypt, decrypt };
