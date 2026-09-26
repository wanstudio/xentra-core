const { describe, it } = require('node:test');
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const js = fs.readFileSync(path.join(ROOT, 'apps/pos-app/assets/js/pos-app.js'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'apps/pos-app/index.html'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'apps/pos-app/assets/css/pos.css'), 'utf8');
const composerJs = fs.readFileSync(path.join(ROOT, 'apps/pos-app/assets/js/TransactionComposer.js'), 'utf8');

describe('POS dine-in transaction composer', () => {
  it('keeps table context inside the cashier draft-sale flow', () => {
    assert.ok(js.includes('function openTableSelector()'));
    assert.ok(js.includes('function applySelectedTable(t)'));
    assert.ok(js.includes("if(tx.getOrderType()==='dine_in'&&!tx.getTable()){openTableSelector();return;}"));
    assert.ok(js.includes("btn-pos-select-table').onclick=function(){openTableSelector();}"));
    assert.ok(html.includes('id="pos-table-context" class="pos-context-strip"'));
  });

  it('allows menu-first and table-first without clearing cart', () => {
    assert.ok(js.includes('composer().setTable(t);'));
    assert.ok(js.includes('renderCart();'));
    assert.ok(!js.includes('state.selectedTable'));
    assert.ok(!js.includes('state.orderType'));
  });

  it('keeps unavailable table states non-selectable', () => {
    assert.ok(js.includes("var can=st==='available'"));
    assert.ok(js.includes("!t||(t.operational_state||t.status||'available')!=='available'"));
    assert.ok(css.includes('.pos-table-pick.disabled'));
  });

  it('uses cache-busted POS assets for the new composer UI', () => {
    assert.ok(/\/pos\/assets\/css\/pos\.css\?v=1\.0\.11/.test(html));
    assert.ok(/\/pos\/assets\/js\/TransactionComposer\.js\?v=1\.0\.11/.test(html));
    assert.ok(/\/pos\/assets\/js\/pos-app\.js\?v=1\.0\.11/.test(html));
    assert.ok(html.indexOf('/pos/assets/js/TransactionComposer.js?v=1.0.11') < html.indexOf('/pos/assets/js/pos-app.js?v=1.0.11'));
    assert.ok(composerJs.includes('MODES'));
    assert.ok(composerJs.includes("NEW: 'new'"));
    assert.ok(composerJs.includes("EXISTING: 'existing'"));
    assert.ok(composerJs.includes("ADDITION: 'addition'"));
  });
});
