'use strict';

const { test, describe, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');

const db = require('../../server/database/db');
const app = require('../../server/app');
const {
  ExistingTenantResolver,
  OwnershipClaimService,
  TenantOwnershipTransferService,
  HandoffService
} = require('../../core/identity');
const axios = require('axios');

process.env.GOOGLE_CLIENT_ID = 'xentra-claim-test-client-id.apps.googleusercontent.com';

const mockGoogleTokens = new Map();
const originalAxiosGet = axios.get;

axios.get = async function(url, config) {
  if (url.includes('oauth2.googleapis.com/tokeninfo')) {
    const idToken = config?.params?.id_token;
    if (mockGoogleTokens.has(idToken)) {
      return { data: mockGoogleTokens.get(idToken) };
    }
  }
  return originalAxiosGet.apply(this, arguments);
};

function formatMockJwt(name) {
  if (typeof name === 'string' && name.includes('.')) return name;
  return `header.${name}.signature`;
}

function registerMockGoogleToken(idToken, payload) {
  const jwt = formatMockJwt(idToken);
  mockGoogleTokens.set(jwt, payload);
  mockGoogleTokens.set(idToken, payload);
  return jwt;
}

function makeRequest(server, options, body = null) {
  return new Promise((resolve, reject) => {
    const port = server.address().port;
    let finalBody = body;
    if (body && typeof body === 'object') {
      finalBody = { ...body };
      if (finalBody.credential && typeof finalBody.credential === 'string') {
        finalBody.credential = formatMockJwt(finalBody.credential);
      }
      if (finalBody.id_token && typeof finalBody.id_token === 'string') {
        finalBody.id_token = formatMockJwt(finalBody.id_token);
      }
    }
    const payload = finalBody != null ? (typeof finalBody === 'string' ? finalBody : JSON.stringify(finalBody)) : null;

    const reqOptions = {
      hostname: '127.0.0.1',
      port,
      path: options.path,
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        Host: 'xentra.cloud',
        ...(payload != null ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
        ...(options.headers || {})
      }
    };

    const req = http.request(reqOptions, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        let parsed = null;
        try {
          parsed = JSON.parse(data);
        } catch (_) {
          parsed = data;
        }
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: parsed,
          raw: data
        });
      });
    });

    req.on('error', reject);
    if (payload != null) {
      req.write(payload);
    }
    req.end();
  });
}

describe('Existing Tenant Claim / Adoption Flow (Bangjo)', () => {
  let server;

  beforeEach(async () => {
    // Ensure Bangjo brand is clean and mapped to app.mybangjo.com
    db.prepare("UPDATE brands SET custom_domain = 'app.mybangjo.com' WHERE id = 'brand_bangjo'").run();

    if (!server) {
      server = http.createServer(app);
      await new Promise(resolve => server.listen(0, resolve));
    }
  });

  after(() => {
    if (server) {
      server.close();
    }
  });

  // 1. ExistingTenantResolver unit validation
  test('1. ExistingTenantResolver normalizes domain and resolves existing tenant without leaking internal secrets', () => {
    const resolver = new ExistingTenantResolver(db);

    // Variations of domain input
    assert.equal(resolver.normalizeDomain('https://app.mybangjo.com/dashboard'), 'app.mybangjo.com');
    assert.equal(resolver.normalizeDomain('http://APP.MYBANGJO.COM:3000/'), 'app.mybangjo.com');
    assert.equal(resolver.normalizeDomain('  app.mybangjo.com  '), 'app.mybangjo.com');

    // Resolution for existing tenant
    const resolved = resolver.resolveByDomain('https://app.mybangjo.com');
    assert.ok(resolved);
    assert.equal(resolved.brand_id, 'brand_bangjo');
    assert.equal(resolved.organization_id, 'org_xentra_holding');
    assert.equal(resolved.business_name, 'Bangjo Resto');
    assert.equal(resolved.custom_domain, 'app.mybangjo.com');

    // Resolution for unknown domain
    const nonExistent = resolver.resolveByDomain('unknown.domain.com');
    assert.equal(nonExistent, null);

    // Control-plane domain must NOT resolve as a tenant
    assert.equal(resolver.resolveByDomain('xentra.cloud'), null);
  });

  // 2. POST /onboarding/check-domain endpoint
  test('2. POST /onboarding/check-domain distinguishes existing vs new domains', async () => {
    // Check existing domain: app.mybangjo.com
    const existingRes = await makeRequest(server, {
      method: 'POST',
      path: '/api/v1/onboarding/check-domain'
    }, { domain: 'https://app.mybangjo.com' });

    assert.equal(existingRes.status, 200);
    assert.equal(existingRes.body.success, true);
    assert.equal(existingRes.body.exists, true);
    assert.equal(existingRes.body.domain, 'app.mybangjo.com');
    assert.equal(existingRes.body.business_name, 'Bangjo Resto');
    assert.ok(existingRes.body.branch_count >= 1);

    // Check non-existent domain: newrestaurant.com
    const newRes = await makeRequest(server, {
      method: 'POST',
      path: '/api/v1/onboarding/check-domain'
    }, { domain: 'newrestaurant.com' });

    assert.equal(newRes.status, 200);
    assert.equal(newRes.body.success, true);
    assert.equal(newRes.body.exists, false);
    assert.equal(newRes.body.domain, 'newrestaurant.com');
  });

  // 3. New business normal registration path remains functional
  test('3. New domain follows normal registration path with no conflicts', async () => {
    const runId = Date.now().toString(36);
    const googleToken = `google-token-new-${runId}`;
    const email = `newowner_${runId}@xentra.cloud`;

    registerMockGoogleToken(googleToken, {
      sub: `google-sub-new-${runId}`,
      email,
      email_verified: true,
      aud: process.env.GOOGLE_CLIENT_ID,
      iss: 'https://accounts.google.com',
      exp: Math.floor(Date.now() / 1000) + 3600,
      name: 'New Owner'
    });

    const res = await makeRequest(server, {
      method: 'POST',
      path: '/api/v1/auth/google-onboard'
    }, {
      credential: googleToken,
      business_name: `Fresh Resto ${runId}`,
      brand_name: `Fresh Resto ${runId}`,
      branch_name: 'Cabang Baru',
      phone: '081234567800'
    });

    assert.equal(res.status, 201);
    assert.equal(res.body.success, true);
    assert.ok(res.body.token.startsWith('xnt_auth_'));
    assert.equal(res.body.user.email, email);
    assert.notEqual(res.body.brand.id, 'brand_bangjo');
  });

  // 4. Duplicate prevention: google-onboard with existing domain fails
  test('4. Attempting to register a new tenant with an existing custom_domain is rejected with 409', async () => {
    const runId = Date.now().toString(36);
    const googleToken = `google-token-dup-${runId}`;

    registerMockGoogleToken(googleToken, {
      sub: `google-sub-dup-${runId}`,
      email: `dup_${runId}@gmail.com`,
      email_verified: true,
      aud: process.env.GOOGLE_CLIENT_ID,
      iss: 'https://accounts.google.com',
      exp: Math.floor(Date.now() / 1000) + 3600,
      name: 'Dup Attempter'
    });

    const res = await makeRequest(server, {
      method: 'POST',
      path: '/api/v1/auth/google-onboard'
    }, {
      credential: googleToken,
      business_name: 'Fake Bangjo Attempt',
      domain: 'app.mybangjo.com' // Existing domain!
    });

    assert.equal(res.status, 409);
    assert.equal(res.body.code, 'TENANT_ALREADY_EXISTS');
  });

  // 5. Existing Tenant Claim (Adoption) flow
  test('5. Existing tenant claim attaches user without duplicating organization, brand, or branch', async () => {
    // Snapshot initial database records
    const orgsBefore = db.prepare("SELECT COUNT(*) as cnt FROM organizations WHERE id = 'org_xentra_holding'").get().cnt;
    const brandsBefore = db.prepare("SELECT COUNT(*) as cnt FROM brands WHERE id = 'brand_bangjo'").get().cnt;
    const allBrandsCountBefore = db.prepare("SELECT COUNT(*) as cnt FROM brands").get().cnt;
    const branchesBefore = db.prepare("SELECT COUNT(*) as cnt FROM branches WHERE brand_id = 'brand_bangjo'").get().cnt;
    const productsBefore = db.prepare("SELECT COUNT(*) as cnt FROM products WHERE brand_id = 'brand_bangjo'").get().cnt;

    // A user signs in with Google on xentra.cloud
    const runId = Date.now().toString(36);
    const googleSub = `google-sub-claimant-${runId}`;
    const googleToken = `google-token-claimant-${runId}`;
    const claimantEmail = `claimant_${runId}@xentra.cloud`;

    registerMockGoogleToken(googleToken, {
      sub: googleSub,
      email: claimantEmail,
      email_verified: true,
      aud: process.env.GOOGLE_CLIENT_ID,
      iss: 'https://accounts.google.com',
      exp: Math.floor(Date.now() / 1000) + 3600,
      name: 'Claimant Owner'
    });

    // Claimant executes POST /onboarding/claim with credential and domain 'app.mybangjo.com'
    const claimRes = await makeRequest(server, {
      method: 'POST',
      path: '/api/v1/onboarding/claim'
    }, {
      domain: 'app.mybangjo.com',
      credential: googleToken
    });

    assert.equal(claimRes.status, 200, `Claim failed: ${JSON.stringify(claimRes.body)}`);
    assert.equal(claimRes.body.success, true);
    assert.ok(claimRes.body.token.startsWith('xnt_auth_'));
    assert.equal(claimRes.body.user.role, 'owner');
    assert.equal(claimRes.body.user.brand_id, 'brand_bangjo');
    assert.equal(claimRes.body.user.organization_id, 'org_xentra_holding');
    assert.equal(claimRes.body.business.brand_id, 'brand_bangjo');
    assert.equal(claimRes.body.business.custom_domain, 'app.mybangjo.com');
    assert.ok(claimRes.body.redirect_url.includes('app.mybangjo.com/dashboard/?handoff=xnt_hdf_'));

    // VERIFY CRITICAL INVARIANTS: NO DUPLICATE CREATION
    const orgsAfter = db.prepare("SELECT COUNT(*) as cnt FROM organizations WHERE id = 'org_xentra_holding'").get().cnt;
    const brandsAfter = db.prepare("SELECT COUNT(*) as cnt FROM brands WHERE id = 'brand_bangjo'").get().cnt;
    const allBrandsCountAfter = db.prepare("SELECT COUNT(*) as cnt FROM brands").get().cnt;
    const branchesAfter = db.prepare("SELECT COUNT(*) as cnt FROM branches WHERE brand_id = 'brand_bangjo'").get().cnt;
    const productsAfter = db.prepare("SELECT COUNT(*) as cnt FROM products WHERE brand_id = 'brand_bangjo'").get().cnt;

    // Check no duplicate brand_bangjo_new or other fake brands created
    assert.equal(orgsAfter, orgsBefore, 'Organization count must remain identical');
    assert.equal(brandsAfter, brandsBefore, 'brand_bangjo must remain intact');
    assert.equal(allBrandsCountAfter, allBrandsCountBefore, 'No duplicate brand or brand_bangjo_new created');
    assert.equal(branchesAfter, branchesBefore, 'Branches must remain untouched');
    assert.equal(productsAfter, productsBefore, 'Catalog and products must remain untouched');

    const fakeBrand = db.prepare("SELECT id FROM brands WHERE id LIKE '%bangjo%new%'").get();
    assert.equal(fakeBrand, undefined, 'Must NEVER create brand_bangjo_new');

    // 6. Verify claimant can seamlessly access Bangjo dashboard via the issued token
    const meRes = await makeRequest(server, {
      method: 'GET',
      path: '/api/v1/auth/merchant/me',
      headers: {
        Host: 'app.mybangjo.com',
        Authorization: `Bearer ${claimRes.body.token}`
      }
    });

    assert.equal(meRes.status, 200);
    assert.equal(meRes.body.user.brand_id, 'brand_bangjo');
    assert.equal(meRes.body.user.role, 'owner');
  });

  // 6. Route Precedence & Host Separation verification
  test('6. Route precedence: xentra.cloud serves onboarding UI and bypasses tenant resolver', async () => {
    // 1. xentra.cloud/onboarding returns onboarding UI
    const res = await makeRequest(server, {
      method: 'GET',
      path: '/onboarding',
      headers: { Host: 'xentra.cloud' }
    });

    assert.equal(res.status, 200);
    assert.ok(res.raw.includes('Xentra Cloud SaaS'));
    assert.ok(res.raw.includes('Saya Sudah Memiliki Bisnis'));
    assert.ok(res.raw.includes('/api/v1/onboarding/check-domain'));
    assert.ok(res.raw.includes('/api/v1/onboarding/claim'));

    // 2. xentra.cloud/ root serves the public SaaS landing page (200) — NOT a redirect to /onboarding
    //    and does NOT render the customer food ordering storefront
    const rootRes = await makeRequest(server, {
      method: 'GET',
      path: '/',
      headers: { Host: 'xentra.cloud' }
    });
    assert.equal(rootRes.status, 200);
    // Landing page must contain Xentra branding and SaaS CTAs, not the food PWA
    assert.ok(rootRes.raw.includes('Xentra') || rootRes.raw.includes('signin'));
    assert.ok(!rootRes.raw.includes('xentra_cart'), '/ on xentra.cloud must not be the customer food PWA');

    // 3. app.mybangjo.com/dashboard/login works
    const dashLoginRes = await makeRequest(server, {
      method: 'GET',
      path: '/dashboard/login',
      headers: { Host: 'app.mybangjo.com' }
    });
    assert.equal(dashLoginRes.status, 200);
    assert.ok(dashLoginRes.raw.includes('Merchant Login') || dashLoginRes.raw.includes('login') || dashLoginRes.raw.includes('Dashboard'));

    // 4. app.mybangjo.com/dashboard/ works
    const dashRes = await makeRequest(server, {
      method: 'GET',
      path: '/dashboard/',
      headers: { Host: 'app.mybangjo.com' }
    });
    assert.equal(dashRes.status, 200);

    // 5. app.mybangjo.com storefront resolution works (serves customer PWA)
    const storefrontRes = await makeRequest(server, {
      method: 'GET',
      path: '/',
      headers: { Host: 'app.mybangjo.com' }
    });
    assert.equal(storefrontRes.status, 200);
    assert.ok(storefrontRes.raw.includes('xentra-home-view') || storefrontRes.raw.includes('Bangjo') || storefrontRes.raw.includes('pwa'));
  });

  // 7. Unauthenticated Claim Flow & Login Claim Context preservation
  test('7. Unauthenticated user claim flow redirects to login preserving claim domain, and login executes claim', async () => {
    // 1. Verify onboarding.html contains redirection logic for unauthenticated claim
    const onboardingRes = await makeRequest(server, {
      method: 'GET',
      path: '/onboarding',
      headers: { Host: 'xentra.cloud' }
    });
    assert.equal(onboardingRes.status, 200);
    assert.ok(onboardingRes.raw.includes('xentra_pending_claim_domain'));
    assert.ok(onboardingRes.raw.includes('/signin?claim_domain='));

    // 2. Verify dashboard login page contains claim banner and claim handling logic
    const loginRes = await makeRequest(server, {
      method: 'GET',
      path: '/dashboard/login?claim_domain=app.mybangjo.com',
      headers: { Host: 'xentra.cloud' }
    });
    assert.equal(loginRes.status, 200);
    assert.ok(loginRes.raw.includes('claim-notice-banner'));
    assert.ok(loginRes.raw.includes('Klaim Kepemilikan Bisnis'));
    assert.ok(loginRes.raw.includes('/api/v1/onboarding/claim'));

    // 3. Register mock Google token for claimant
    const googleEmail = `unauth-claim-${Date.now()}@example.com`;
    const googleSub = `sub-${Date.now()}`;
    const googleToken = registerMockGoogleToken(`unauth-jwt-${Date.now()}`, {
      sub: googleSub,
      email: googleEmail,
      email_verified: true,
      aud: process.env.GOOGLE_CLIENT_ID,
      iss: 'https://accounts.google.com',
      exp: Math.floor(Date.now() / 1000) + 3600,
      name: 'Unauth Claimant'
    });

    // 4. Submit Google credential directly to claim endpoint (as handleGoogleCredentialResponse does when claimDomain is set)
    const claimRes = await makeRequest(server, {
      method: 'POST',
      path: '/api/v1/onboarding/claim'
    }, {
      domain: 'app.mybangjo.com',
      credential: googleToken
    });

    assert.equal(claimRes.status, 200);
    assert.equal(claimRes.body.success, true);
    assert.ok(claimRes.body.token);
    assert.equal(claimRes.body.user.role, 'owner');
    assert.equal(claimRes.body.user.brand_id, 'brand_bangjo');
    assert.ok(claimRes.body.redirect_url.includes('handoff='));
  });
});
