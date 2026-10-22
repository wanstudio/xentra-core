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

test('ITEM EDITOR VARIANTS SUITE', async (t) => {
  const orgId = 'org_item_var_' + Date.now();
  const brandId = 'brand_test_item_var_' + Date.now();
  db.prepare("INSERT OR IGNORE INTO organizations (id, name, slug) VALUES (?, 'Org Item Var', ?)").run(orgId, 'slug-' + orgId);
  db.prepare("INSERT INTO brands (id, organization_id, name, slug) VALUES (?, ?, 'Brand Item Var Test', ?)").run(brandId, orgId, 'slug-' + brandId);

  await t.test('1. HTML markup contains Card Varian with mutual toggle switches in both apps', () => {
    const ownerHtml = fs.readFileSync(path.join(__dirname, '../apps/owner-app/index.html'), 'utf8');
    const dashboardHtml = fs.readFileSync(path.join(__dirname, '../apps/merchant-dashboard/index.html'), 'utf8');

    for (const [name, html] of [['owner-app', ownerHtml], ['merchant-dashboard', dashboardHtml]]) {
      assert.ok(html.includes('id="card-prod-variants"'), `${name} must contain card-prod-variants`);
      assert.ok(html.includes('id="toggle-prod-variant-merchant"'), `${name} must contain toggle-prod-variant-merchant`);
      assert.ok(html.includes('id="toggle-prod-variant-customer"'), `${name} must contain toggle-prod-variant-customer`);
      assert.ok(html.includes('id="container-prod-variant-options"'), `${name} must contain container-prod-variant-options`);
      assert.ok(html.includes('id="prod-variant-checklist-items"'), `${name} must contain prod-variant-checklist-items`);
      assert.equal(html.includes('id="input-new-prod-variant"'), false, `${name} should not have extra variant input`);
      assert.equal(html.includes('id="btn-add-prod-variant"'), false, `${name} should not have extra variant add button`);
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

  await t.test('4. Frontend DOM interaction: toggle radio mutual exclusivity and variant checklist', () => {
    const html = fs.readFileSync(path.join(__dirname, '../apps/owner-app/index.html'), 'utf8');
    const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'http://localhost' });
    const { window } = dom;

    // Load catalog.js
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

    const toggleMerchant = window.document.getElementById('toggle-prod-variant-merchant');
    const toggleCustomer = window.document.getElementById('toggle-prod-variant-customer');
    const container = window.document.getElementById('container-prod-variant-options');
    const checklist = window.document.getElementById('prod-variant-checklist-items');
    const inputNew = window.document.getElementById('input-new-prod-variant');
    const btnAdd = window.document.getElementById('btn-add-prod-variant');

    assert.ok(toggleMerchant, 'Merchant toggle exists');
    assert.ok(toggleCustomer, 'Customer toggle exists');
    assert.ok(container, 'Container options exists');
    assert.equal(inputNew, null, 'Extra variant input must not exist');
    assert.equal(btnAdd, null, 'Extra variant add button must not exist');

    // Initially container should be hidden
    assert.equal(container.style.display, 'none');
    assert.equal(toggleMerchant.checked, false);
    assert.equal(toggleCustomer.checked, false);

    // 1. Click toggle Customer ON
    toggleCustomer.click();
    assert.equal(toggleCustomer.checked, true, 'Customer toggle should be ON');
    assert.equal(toggleMerchant.checked, false, 'Merchant toggle should be OFF');
    assert.equal(container.style.display, 'block', 'Container should be visible');

    // Checklist should contain EXACTLY 3 default variants (Pedas, Suhu, Opsi lain)
    const items = checklist.querySelectorAll('.x-variant-item-row');
    assert.equal(items.length, 3, 'Must render exactly 3 variants: Pedas, Suhu, Opsi lain');

    // 2. Click toggle Merchant ON -> Customer must turn OFF (mutual exclusivity)
    toggleMerchant.click();
    assert.equal(toggleMerchant.checked, true, 'Merchant toggle should be ON');
    assert.equal(toggleCustomer.checked, false, 'Customer toggle should turn OFF');
    assert.equal(container.style.display, 'block', 'Container should still be visible');

    // In MERCHANT mode ("Kamu mengatur"), Suhu is excluded!
    const merchantItems = checklist.querySelectorAll('.x-variant-item-row');
    assert.equal(merchantItems.length, 2, 'Must render exactly 2 variants in Kamu mengatur (Pedas and Opsi lain, Suhu excluded)');
    assert.equal(checklist.querySelector('[data-variant-name="Suhu (Panas/Dingin)"]'), null, 'Suhu must not be in Kamu mengatur');

    // 3. Click toggle Merchant again -> should turn OFF (both OFF)
    toggleMerchant.click();
    assert.equal(toggleMerchant.checked, false, 'Merchant toggle should turn OFF');
    assert.equal(toggleCustomer.checked, false, 'Customer toggle should stay OFF');
    assert.equal(container.style.display, 'none', 'Container should be hidden when both are off');

    // 4. Click Customer ON again, then toggle Pedas radio button
    toggleCustomer.click();
    assert.equal(toggleCustomer.checked, true);
    const pedasRow = checklist.querySelector('.x-variant-item-row');
    assert.ok(pedasRow);
    const indicatorBefore = pedasRow.querySelector('.x-variant-check-indicator');
    assert.equal(indicatorBefore.classList.contains('active'), false);

    pedasRow.click();
    const indicatorAfter = checklist.querySelector('.x-variant-item-row .x-variant-check-indicator');
    assert.equal(indicatorAfter.classList.contains('active'), true, 'Clicked variant should become active');

    // 4b. 5 Level boxes should be rendered under Pedas in Item Editor
    const levelBoxes = checklist.querySelectorAll('.x-pedas-level-box');
    assert.equal(levelBoxes.length, 5, 'Pedas should render 5 square level boxes');
    // Click level 3
    levelBoxes[2].click();
    const activeLevelBox = checklist.querySelector('.x-pedas-level-box[data-level="3"]');
    assert.ok(activeLevelBox);
    assert.equal(activeLevelBox.style.background, 'rgb(15, 23, 42)', 'Level 3 box should be highlighted');

    // 5. Check editable 'Opsi lain' text input
    const opsiLainInput = checklist.querySelector('.x-variant-name-edit');
    assert.ok(opsiLainInput, 'Opsi lain should have editable input');
    assert.equal(opsiLainInput.value, 'Opsi lain');

    // Owner types 'Topping' into Opsi lain
    opsiLainInput.value = 'Topping';
    opsiLainInput.dispatchEvent(new window.Event('input'));
    opsiLainInput.dispatchEvent(new window.Event('change'));

    // Check indicator on Topping row (clicking Topping turns it ON and turns Pedas OFF)
    const toppingRow = opsiLainInput.closest('.x-variant-item-row');
    const toppingCheck = toppingRow.querySelector('.x-variant-check-indicator');
    toppingCheck.click();
    const activeIndicator = checklist.querySelector('[data-variant-name="Topping"] .x-variant-check-indicator');
    assert.ok(activeIndicator);
    assert.equal(activeIndicator.classList.contains('active'), true, 'Topping should become active');

    // VERIFY RADIO BUTTON MUTUAL EXCLUSIVITY: Pedas MUST BE DEACTIVATED!
    const pedasIndicatorAfterTopping = checklist.querySelector('[data-variant-name="Pedas"] .x-variant-check-indicator');
    assert.equal(pedasIndicatorAfterTopping.classList.contains('active'), false, 'Pedas MUST become inactive when Topping is selected (radio button mutual exclusivity)');

    // 6. Checkbox Builder should be displayed underneath active custom variant
    const activeToppingRow = checklist.querySelector('[data-variant-name="Topping"]');
    assert.equal(activeToppingRow.querySelector('.x-btn-delete-variant'), null, 'Opsi lain container must NOT have a trash delete icon');
    const builder = activeToppingRow.querySelector('.x-variant-checkbox-builder');
    assert.ok(builder, 'Checkbox builder must be rendered when custom variant is active');

    // Add another choice so we have 2 choices
    const btnAddChoiceInitial = builder.querySelector('.x-btn-add-choice');
    btnAddChoiceInitial.click();

    // Query refreshed DOM
    let choiceInputs = checklist.querySelectorAll('[data-variant-name="Topping"] .x-variant-choice-input');
    let deleteButtons = checklist.querySelectorAll('[data-variant-name="Topping"] .x-btn-delete-choice');

    assert.ok(choiceInputs.length >= 2, 'Should have at least 2 choices');
    assert.equal(deleteButtons.length, choiceInputs.length, 'Every choice must have a trash delete button');

    // Simulate scenario: user types custom labels, then deletes 1 choice with trash icon
    choiceInputs[0].value = 'Keju';
    choiceInputs[0].dispatchEvent(new window.Event('input'));
    choiceInputs[1].value = 'Cokelat';
    choiceInputs[1].dispatchEvent(new window.Event('input'));

    const initialCount = choiceInputs.length;
    // Click delete trash icon on the last choice
    deleteButtons[deleteButtons.length - 1].click();

    // After deletion, choice count should decrease by 1
    const updatedBuilder = checklist.querySelector('[data-variant-name="Topping"] .x-variant-checkbox-builder');
    const updatedChoices = updatedBuilder.querySelectorAll('.x-variant-choice-input');
    assert.equal(updatedChoices.length, initialCount - 1, 'Choice count must decrease after clicking trash delete button');
    assert.equal(updatedChoices[0].value, 'Keju');

    // Click + Tambah pilihan
    const updatedAddBtn = updatedBuilder.querySelector('.x-btn-add-choice');
    updatedAddBtn.click();
    const reloadedChoices = checklist.querySelectorAll('[data-variant-name="Topping"] .x-variant-choice-input');
    assert.equal(reloadedChoices.length, initialCount, 'Choice count must increase after clicking + Tambah pilihan');

    // 7. Click Suhu radio button -> Topping must turn OFF and checkbox builder must disappear
    const suhuRow = checklist.querySelector('[data-variant-name="Suhu (Panas/Dingin)"]');
    assert.ok(suhuRow, 'Suhu row must exist');
    suhuRow.click();

    const suhuIndicator = checklist.querySelector('[data-variant-name="Suhu (Panas/Dingin)"] .x-variant-check-indicator');
    assert.equal(suhuIndicator.classList.contains('active'), true, 'Suhu should become active');
    const toppingIndicatorAfterSuhu = checklist.querySelector('[data-variant-name="Topping"] .x-variant-check-indicator');
    assert.equal(toppingIndicatorAfterSuhu.classList.contains('active'), false, 'Topping must become inactive when Suhu is clicked');
    const toppingBuilderAfterSuhu = checklist.querySelector('[data-variant-name="Topping"] .x-variant-checkbox-builder');
    assert.equal(toppingBuilderAfterSuhu, null, 'Topping checkbox builder must disappear when Topping is inactive');

    // Verify there are strictly 3 variant rows in total
    const finalRows = checklist.querySelectorAll('.x-variant-item-row');
    assert.equal(finalRows.length, 3, 'Variant list must contain strictly 3 variants: Pedas, Suhu, Opsi lain');
  });

  await t.test('5. Menu Editor renders Pedas (5 boxes), Suhu (radios), Checkboxes (Topping), and [Atur item] button', () => {
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

    const variantContainer = container.querySelector('.x-cm-item-variants-container');
    assert.ok(variantContainer, 'Variant container should be rendered in Menu Editor for product with variants');

    // 1. Pedas: 5 level boxes
    assert.ok(variantContainer.textContent.includes('Pedas'));
    assert.ok(variantContainer.textContent.includes('Level 1 - 5'));
    assert.ok(variantContainer.textContent.includes('1'));
    assert.ok(variantContainer.textContent.includes('5'));

    // 2. Suhu: Panas / Dingin
    assert.ok(variantContainer.textContent.includes('Suhu'));
    assert.ok(variantContainer.textContent.includes('Panas'));
    assert.ok(variantContainer.textContent.includes('Dingin'));

    // 3. Checkbox Group: Topping
    assert.ok(variantContainer.textContent.includes('Topping'));
    assert.ok(variantContainer.textContent.includes('Keju Mozzarella'));
    assert.ok(variantContainer.textContent.includes('Kulit Crispy'));
    assert.ok(variantContainer.textContent.includes('Telur Ceplok'));

    // 4. [Atur item] button
    const btnAturItem = variantContainer.querySelector('.x-btn-edit-item-variant');
    assert.ok(btnAturItem, '[Atur item] button must be present');
    assert.ok(btnAturItem.textContent.includes('Atur item'));

    btnAturItem.click();
    assert.equal(editedProductId, testProd.id, 'Clicking [Atur item] must open the Item Editor for this item');
  });

  await t.test('6. Full round-trip: item editor saves edited variant, rehydrates template slots on re-open, and updates master menu state', async () => {
    const html = fs.readFileSync(path.join(__dirname, '../apps/owner-app/index.html'), 'utf8');
    const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'http://localhost' });
    const { window } = dom;

    let savedPayload = null;
    let productsDb = [
      {
        id: 'prod_sambal_99',
        name: 'Sambal Korek Bawang',
        sku: 'SBL-099',
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

    const toggleMerchant = window.document.getElementById('toggle-prod-variant-merchant');
    const checklist = window.document.getElementById('prod-variant-checklist-items');

    // Turn ON Kamu mengatur
    toggleMerchant.click();
    assert.equal(toggleMerchant.checked, true);

    // Click Pedas row to activate Pedas
    const pedasRow = checklist.querySelector('[data-variant-name="Pedas"]');
    assert.ok(pedasRow, 'Pedas row must exist');
    pedasRow.click();

    // Click Pedas level 4
    const levelBox4 = checklist.querySelector('.x-pedas-level-box[data-level="4"]');
    assert.ok(levelBox4, 'Level box 4 must exist');
    levelBox4.click();

    // Submit form
    const form = window.document.getElementById('form-product');
    form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));

    // Verify saved payload
    assert.ok(savedPayload, 'Payload must be sent to PUT endpoint');
    assert.ok(savedPayload.options_config, 'options_config must be in payload');
    assert.equal(savedPayload.options_config.mode, 'MERCHANT');
    const pedasVar = savedPayload.options_config.variants.find((v) => v.name === 'Pedas');
    assert.ok(pedasVar);
    assert.equal(pedasVar.active, true);
    assert.equal(pedasVar.level, 4);

    // 2. Re-open the item in item editor — ensure all 3 base slots are preserved and rehydrated
    await window.loadProductEditorPage('prod_sambal_99');

    assert.equal(toggleMerchant.checked, true, 'Merchant toggle should stay ON on reload');
    const reloadedPedas4 = checklist.querySelector('.x-pedas-level-box[data-level="4"]');
    assert.ok(reloadedPedas4);
    assert.equal(reloadedPedas4.style.background, 'rgb(15, 23, 42)', 'Level 4 should stay selected');

    // Switch to Customer mode to verify Suhu and Opsi lain were NOT lost
    const toggleCustomer = window.document.getElementById('toggle-prod-variant-customer');
    toggleCustomer.click();
    assert.equal(toggleCustomer.checked, true);

    const reloadedRows = checklist.querySelectorAll('.x-variant-item-row');
    assert.equal(reloadedRows.length, 3, 'All 3 variant options (Pedas, Suhu, Opsi lain) must be available in Customer mode');
    assert.ok(checklist.querySelector('[data-variant-name="Suhu (Panas/Dingin)"]'), 'Suhu must still be available');
    assert.ok(checklist.querySelector('[data-variant-name="Opsi lain"]'), 'Opsi lain must still be available');
  });
});
