'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const express = require('express');
const http = require('node:http');

const db = require('../server/database/db');
const { ComposedProductService } = require('../domains/catalog');
const adminComposedMenuRoutes = require('../server/routes/admin-composed-menu');

test('ITEM EDITOR & MENU EDITOR ARCHITECTURAL SEPARATION SUITE', async (t) => {
  const orgId = 'org_item_var_' + Date.now();
  const brandId = 'brand_test_item_var_' + Date.now();
  db.prepare("INSERT OR IGNORE INTO organizations (id, name, slug) VALUES (?, 'Org Item Var', ?)").run(orgId, 'slug-' + orgId);
  db.prepare("INSERT INTO brands (id, organization_id, name, slug) VALUES (?, ?, 'Brand Item Var Test', ?)").run(brandId, orgId, 'slug-' + brandId);

  await t.test('1. HTML markup isolates Item Master from customer variants (no card-prod-variants in either app)', () => {
    const ownerHtml = fs.readFileSync(path.join(__dirname, '../apps/owner-app/index.html'), 'utf8');
    const dashboardHtml = fs.readFileSync(path.join(__dirname, '../apps/merchant-dashboard/index.html'), 'utf8');

    for (const [name, html] of [['owner-app', ownerHtml], ['merchant-dashboard', dashboardHtml]]) {
      // Industry Standard: Commercial variants (Hot/Cold, Spice levels, Modifiers) belong in Menu Editor, NOT Item Master
      assert.equal(html.includes('id="card-prod-variants"'), false, `${name} must NOT contain card-prod-variants in Item Editor`);
      assert.equal(html.includes('id="toggle-prod-variant-merchant"'), false, `${name} must NOT contain toggle-prod-variant-merchant`);
      assert.equal(html.includes('id="toggle-prod-variant-customer"'), false, `${name} must NOT contain toggle-prod-variant-customer`);

      // Item Editor must contain essential operational inventory cards
      assert.ok(html.includes('id="prod-name"'), `${name} must contain prod-name`);
      assert.ok(html.includes('id="row-prod-type-cooked"'), `${name} must contain row-prod-type-cooked`);
      assert.ok(html.includes('id="row-prod-type-direct"'), `${name} must contain row-prod-type-direct`);
      assert.ok(html.includes('id="card-prod-recipe-cost-info"'), `${name} must contain card-prod-recipe-cost-info`);
      assert.ok(html.includes('id="card-prod-cost-price"'), `${name} must contain card-prod-cost-price`);
      assert.ok(html.includes('id="prod-manage-stock-toggle"'), `${name} must contain prod-manage-stock-toggle`);
      assert.ok(html.includes('id="prod-desc"'), `${name} must contain prod-desc`);
    }
  });

  await t.test('2. ComposedProductService saves and loads options_config for product variants', () => {
    const variantPayload = {
      mode: 'CUSTOMER',
      variants: [
        { name: 'Pedas', active: true },
        { name: 'Suhu (Panas/Dingin)', active: false },
        { name: 'Opsi lain', active: false }
      ]
    };

    const created = ComposedProductService.createProduct({
      brandId,
      name: 'Sambal Geprek Level',
      sku: 'SBL-GPRK-001',
      optionsConfig: variantPayload
    });

    assert.ok(created.id, 'Product created with ID');
    assert.equal(created.name, 'Sambal Geprek Level');
    assert.ok(created.options_config, 'options_config should be present');

    const parsed = typeof created.options_config === 'string' ? JSON.parse(created.options_config) : created.options_config;
    assert.equal(parsed.mode, 'CUSTOMER');
    assert.equal(parsed.variants.length, 3);
    assert.equal(parsed.variants[0].name, 'Pedas');
    assert.equal(parsed.variants[0].active, true);

    // Update to MERCHANT mode
    const updatedPayload = {
      mode: 'MERCHANT',
      variants: [
        { name: 'Pedas', active: true }
      ]
    };

    const updated = ComposedProductService.updateProduct({
      brandId,
      productId: created.id,
      optionsConfig: updatedPayload
    });

    const parsedUpdated = typeof updated.options_config === 'string' ? JSON.parse(updated.options_config) : updated.options_config;
    assert.equal(parsedUpdated.mode, 'MERCHANT');
    assert.equal(parsedUpdated.variants.length, 1);
  });

  await t.test('3. REST API /admin/composed/products supports options_config in create and update', async () => {
    const app = express();
    app.use(express.json());
    app.use((req, res, next) => {
      req.user = { id: 'usr_test', role: 'owner' };
      req.brand_id = brandId;
      next();
    });
    adminComposedMenuRoutes(app, {
      requireAuth: () => (req, res, next) => next()
    });

    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;

    try {
      const createRes = await fetch(`http://127.0.0.1:${port}/admin/composed/products`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Es Teh Manis Segar',
          sku: 'EST-001',
          options_config: {
            mode: 'CUSTOMER',
            variants: [
              { name: 'Rasa (Manis / Tawar)', active: true },
              { name: 'Suhu (Panas / Dingin)', active: true }
            ]
          }
        })
      });

      const createData = await createRes.json();
      assert.equal(createRes.status, 201);
      assert.equal(createData.success, true);
      assert.ok(createData.product.options_config);

      const prodId = createData.product.id;

      // Update options_config via PUT
      const updateRes = await fetch(`http://127.0.0.1:${port}/admin/composed/products/${prodId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          options_config: {
            mode: 'MERCHANT',
            variants: [
              { name: 'Rasa (Manis)', active: true }
            ]
          }
        })
      });

      const updateData = await updateRes.json();
      assert.equal(updateRes.status, 200);
      assert.equal(updateData.success, true);
      const parsed = typeof updateData.product.options_config === 'string'
        ? JSON.parse(updateData.product.options_config)
        : updateData.product.options_config;
      assert.equal(parsed.mode, 'MERCHANT');
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  await t.test('4. Frontend DOM interaction: Item Editor toggles operational inventory types (Cooked vs Direct)', () => {
    const html = fs.readFileSync(path.join(__dirname, '../apps/owner-app/index.html'), 'utf8');
    const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'http://localhost' });
    const { window } = dom;

    const catalogJs = fs.readFileSync(path.join(__dirname, '../apps/merchant-dashboard/assets/js/modules/catalog.js'), 'utf8');
    window.API_BASE = '/api';
    window.showToast = () => {};
    window.formatMoney = (n) => 'Rp' + n;
    window.getAuthHeaders = () => ({});
    window.adminFetch = async () => ({ ok: true, json: async () => ({ success: true }) });
    window.eval(catalogJs);

    if (typeof window.initCatalogListeners === 'function') {
      window.initCatalogListeners();
    }

    const toggleCooked = window.document.getElementById('toggle-prod-type-cooked');
    const toggleDirect = window.document.getElementById('toggle-prod-type-direct');
    const rowDirect = window.document.getElementById('row-prod-type-direct');
    const rowCooked = window.document.getElementById('row-prod-type-cooked');
    const cardCostPrice = window.document.getElementById('card-prod-cost-price');
    const cardRecipeCost = window.document.getElementById('card-prod-recipe-cost-info');

    assert.ok(toggleCooked, 'Cooked toggle exists');
    assert.ok(toggleDirect, 'Direct toggle exists');
    assert.ok(cardCostPrice, 'Cost price card exists');
    assert.ok(cardRecipeCost, 'Recipe cost info card exists');

    // Default state: Pakai Resep (COOKED)
    assert.equal(toggleCooked.checked, true, 'Default must be Cooked (Pakai Resep)');
    assert.equal(toggleDirect.checked, false, 'Default Direct must be unchecked');
    assert.equal(cardCostPrice.style.display, 'none', 'Cost price is hidden for Cooked items');

    // Switch to DIRECT (Siap Jual Non-Resep)
    rowDirect.click();
    assert.equal(toggleDirect.checked, true, 'Direct toggle should be checked after click');
    assert.equal(toggleCooked.checked, false, 'Cooked toggle should be unchecked');
    assert.equal(cardCostPrice.style.display, 'block', 'Cost price should be visible for Direct items');
    assert.equal(cardRecipeCost.style.display, 'none', 'Recipe cost info should be hidden for Direct items');

    // Switch back to COOKED
    rowCooked.click();
    assert.equal(toggleCooked.checked, true, 'Cooked toggle should be checked after click');
    assert.equal(toggleDirect.checked, false, 'Direct toggle should be unchecked');
    assert.equal(cardCostPrice.style.display, 'none', 'Cost price should be hidden for Cooked items');
    assert.equal(cardRecipeCost.style.display, 'block', 'Recipe cost info should be visible for Cooked items');
  });

  await t.test('5. Menu Editor renders Pedas (chips), Suhu (radios), Checkboxes (Topping), and [Atur item] button', () => {
    const html = fs.readFileSync(path.join(__dirname, '../apps/owner-app/index.html'), 'utf8');
    const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'http://localhost' });
    const { window } = dom;

    const masterMenuJs = fs.readFileSync(path.join(__dirname, '../apps/merchant-dashboard/assets/js/modules/master-menu.js'), 'utf8');
    window.API_BASE = '/api';
    window.showToast = () => {};
    window.formatMoney = (n) => 'Rp' + n;
    window.getAuthHeaders = () => ({});
    window.adminFetch = async () => ({ ok: true, json: async () => ({ success: true }) });
    let editedProductId = null;
    window.openEditProduct = (id) => { editedProductId = id; };

    window.eval(masterMenuJs);

    const testProd = {
      id: 'prod_ayam_geprek_99',
      name: 'Ayam Geprek Sambal Korek',
      is_active: 1,
      options_config: {
        mode: 'CUSTOMER',
        variants: [
          { name: 'Pedas', active: true, type: 'level' },
          { name: 'Suhu (Panas/Dingin)', active: true, type: 'radio' },
          { name: 'Topping', active: true, type: 'checkbox', choices: ['Keju Mozzarella', 'Kulit Crispy', 'Telur Ceplok'] }
        ]
      }
    };

    if (window._ownerMasterMenuState) {
      window._ownerMasterMenuState.products = [testProd];
      window._ownerMasterMenuState.menuItems = [{ product_id: testProd.id, quantity: 1 }];
    }

    if (typeof window.renderOwnerMasterMenuItems === 'function') {
      window.renderOwnerMasterMenuItems();
    }

    const container = window.document.getElementById('cm-items-container');
    assert.ok(container, 'Items container should exist');

    const variantBlocks = container.querySelectorAll('.x-cm-item-variant-block');
    assert.ok(variantBlocks.length > 0, 'Variant blocks should be rendered in Menu Editor for product with variants');

    // 1. Pedas: 5 level chips
    assert.ok(container.textContent.includes('Pedas'));
    assert.ok(container.textContent.includes('Pelanggan memilih: Pedas'));

    // 2. Suhu: Panas / Dingin
    assert.ok(container.textContent.includes('Suhu (Panas/Dingin)'));
    assert.ok(container.textContent.includes('Panas'));
    assert.ok(container.textContent.includes('Dingin'));

    // 3. Checkbox Group: Topping
    assert.ok(container.textContent.includes('Topping'));
    assert.ok(container.textContent.includes('Keju Mozzarella'));
    assert.ok(container.textContent.includes('Kulit Crispy'));
    assert.ok(container.textContent.includes('Telur Ceplok'));

    // 4. [Atur item] button
    const btnAturItem = container.querySelector('.x-btn-edit-item-variant');
    assert.ok(btnAturItem, '[Atur item] button must be present in Menu Editor');
    assert.ok(btnAturItem.textContent.includes('Atur item'));

    btnAturItem.click();
    assert.equal(editedProductId, testProd.id, 'Clicking [Atur item] must open item editor for this product');
  });

  await t.test('6. Full round-trip: Item Editor saves operational product cleanly without injecting variant clutter', async () => {
    const html = fs.readFileSync(path.join(__dirname, '../apps/owner-app/index.html'), 'utf8');
    const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'http://localhost' });
    const { window } = dom;

    let savedPayload = null;
    let productsDb = [
      {
        id: 'prod_sambal_99',
        name: 'Sambal Korek Bawang',
        sku: 'SBL-099',
        inventory_type: 'COOKED',
        is_active: 1,
        options_config: null
      }
    ];

    window.API_BASE = '/api';
    window.showToast = () => {};
    window.formatMoney = (n) => 'Rp' + n;
    window.getAuthHeaders = () => ({});
    window.adminFetch = async (url, opts) => {
      if (opts && opts.method === 'PUT') {
        savedPayload = JSON.parse(opts.body);
        productsDb[0] = Object.assign({}, productsDb[0], savedPayload);
        return {
          ok: true,
          json: async () => ({
            success: true,
            product: productsDb[0]
          })
        };
      }
      return {
        ok: true,
        json: async () => ({
          success: true,
          products: productsDb
        })
      };
    };

    const catalogJs = fs.readFileSync(path.join(__dirname, '../apps/merchant-dashboard/assets/js/modules/catalog.js'), 'utf8');
    window.eval(catalogJs);

    if (typeof window.initCatalogListeners === 'function') {
      window.initCatalogListeners();
    }

    // 1. Load item into product editor
    await window.loadProductEditorPage('prod_sambal_99');

    const nameInput = window.document.getElementById('prod-name');
    assert.equal(nameInput.value, 'Sambal Korek Bawang');

    // Switch to DIRECT item
    const rowDirect = window.document.getElementById('row-prod-type-direct');
    rowDirect.click();

    // Enable SKU stock management and set SKU
    const manageStockToggle = window.document.getElementById('prod-manage-stock-toggle');
    manageStockToggle.checked = true;
    manageStockToggle.dispatchEvent(new window.Event('change'));

    const skuInput = window.document.getElementById('prod-sku');
    skuInput.value = 'SBL-099-DIR';

    // Submit form
    const form = window.document.getElementById('form-product');
    form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));

    // Verify saved payload
    assert.ok(savedPayload, 'Payload must be sent to PUT endpoint');
    assert.equal(savedPayload.name, 'Sambal Korek Bawang');
    assert.equal(savedPayload.inventory_type, 'DIRECT');
    assert.equal(savedPayload.sku, 'SBL-099-DIR');
    // Critical architecture proof: Item Master does NOT inject options_config when variants are not enabled
    assert.equal(savedPayload.options_config, null, 'Operational Item Master should not inject customer options_config');
  });
});
