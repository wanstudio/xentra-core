const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

test('DRIVER-RBAC-01: Driver is a first-class branch-scoped workforce role', () => {
  const role = read('core/identity/RoleModel.js');
  const permissions = read('core/identity/PermissionModel.js');
  const workforce = read('core/identity/WorkforceService.js');

  assert.match(role, /DRIVER:\s*'driver'/);
  assert.match(permissions, /\[RoleModel\.ROLES\.DRIVER\]:\s*\[[\s\S]*'delivery:view'[\s\S]*'delivery:execute'[\s\S]*\]/);
  assert.doesNotMatch(permissions, /\[RoleModel\.ROLES\.DRIVER\]:[\s\S]*'delivery:manage'/);
  assert.match(workforce, /role === 'driver' && !branch_id/);
});

test('DRIVER-RBAC-02: Driver API surface is authenticated and branch scoped', () => {
  const api = read('server/routes/api.js');
  const driver = read('server/routes/driver.js');

  assert.match(api, /registerDriverRoutes\(router/);
  assert.match(api, /branchScopedRoles\s*=\s*\['branch_manager', 'cashier', 'kitchen', 'driver'\]/);
  assert.match(driver, /const driverAuth = requireAuth\(\['driver'\]\)/);
  assert.match(driver, /o\.branch_id = \?/);
  assert.match(driver, /d\.driver_id = \?/);
});

test('DRIVER-RBAC-03: Driver assignment only accepts active Driver from the order branch', () => {
  const provider = read('domains/delivery/providers/BranchDriverProvider.js');

  assert.match(provider, /driver\.role !== 'driver'/);
  assert.match(provider, /driver\.status !== 'active'/);
  assert.match(provider, /driver\.brand_id !== order\.brand_id/);
  assert.match(provider, /driver\.branch_id !== order\.branch_id/);
});

test('DRIVER-UX-01: Unified login and invitation land on Driver PWA', () => {
  const login = read('apps/merchant-dashboard/login.html');
  const workforce = read('server/routes/workforce.js');
  const handoff = read('core/identity/HandoffService.js');

  assert.match(login, /isDriverSurface/);
  assert.match(login, /role === 'driver'/);
  assert.match(login, /return '\/driver\/'/);
  assert.match(workforce, /result\.role === 'driver' \? '\/driver\/'/);
  assert.match(handoff, /user\.role === 'driver'/);
});

test('DRIVER-UX-02: Production Driver UI does not ship hardcoded business demo records', () => {
  const driverUi = read('apps/driver-app/assets/js/driver-app.js');

  assert.doesNotMatch(driverUi, /Andi Pratama|XTR-1042|87,?000|Bangjo Timur/);
  assert.match(driverUi, /fetch\('\/api\/v1' \+ path/);
  assert.match(driverUi, /\/driver\/tasks/);
  assert.match(driverUi, /\/driver\/me/);
});

test('DRIVER-UX-03: Driver profile photo upload integrates with XentraCropEditor and Media Engine', () => {
  const indexHtml = read('apps/driver-app/index.html');
  const driverUi = read('apps/driver-app/assets/js/driver-app.js');
  const driverRoute = read('server/routes/driver.js');

  // DOM modal & shared assets wired in index.html
  assert.match(indexHtml, /id="modal-crop-editor"/);
  assert.match(indexHtml, /\/merchant-shared\/js\/crop-editor\.js/);
  assert.match(indexHtml, /\/merchant-shared\/css\/shared\.css/);

  // Crop editor invoked for 1:1 avatar
  assert.match(driverUi, /window\.XentraCropEditor/);
  assert.match(driverUi, /assetType:\s*'avatar'/);
  assert.match(driverUi, /aspectRatio:\s*1\.0/);
  assert.match(driverUi, /payload\.crop_spec = cropSpec/);

  // Backend receives crop_spec and uses MediaService
  assert.match(driverRoute, /router\.post\('\/driver\/avatar'/);
  assert.match(driverRoute, /mediaService\.stageUpload/);
  assert.match(driverRoute, /mediaService\.processMedia/);
  assert.match(driverRoute, /cropSpec:\s*crop_spec/);
});

test('DRIVER-UX-04: Driver personal details and KTP identity verification are persisted', () => {
  const dbSchema = read('server/database/db.js');
  const driverRoute = read('server/routes/driver.js');
  const driverUi = read('apps/driver-app/assets/js/driver-app.js');

  // Database persistence columns
  assert.match(dbSchema, /phone TEXT/);
  assert.match(dbSchema, /nik TEXT/);
  assert.match(dbSchema, /ktp_url TEXT/);

  // Profile endpoints
  assert.match(driverRoute, /router\.put\('\/driver\/profile'/);
  assert.match(driverRoute, /router\.post\('\/driver\/ktp'/);

  // Frontend sheet & crop integration for KTP
  assert.match(driverUi, /showEditProfileSheet/);
  assert.match(driverUi, /showVerifyKtpSheet/);
  assert.match(driverUi, /aspectRatio:\s*1\.586/);
});


