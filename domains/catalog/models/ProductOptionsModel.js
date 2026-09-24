'use strict';

/**
 * Product options contract for Xentra POS / Commerce.
 *
 * MVP intentionally supports only:
 * - variant: single choice per group
 * - addon: multiple choices per group
 * No nested options or conditional modifier engine.
 */
class ProductOptionsModel {
  static normalizeConfig(raw) {
    if (raw == null || raw === '') return { version: 1, groups: [] };

    let config = raw;
    if (typeof raw === 'string') {
      try { config = JSON.parse(raw); } catch (_) { return { version: 1, groups: [] }; }
    }

    const groups = Array.isArray(config && config.groups) ? config.groups : [];

    return {
      version: 1,
      groups: groups.map((g, gi) => {
        const type = g && g.type != null ? String(g.type).trim() : 'variant';
        const groupId = String((g && g.id) || `group_${gi + 1}`).trim();
        const options = Array.isArray(g && g.options) ? g.options : [];
        const required = type === 'variant' ? !(g && g.required === false) : Boolean(g && g.required === true);
        const min = type === 'variant'
          ? (required ? 1 : 0)
          : Math.max(required ? 1 : 0, Number.isInteger(Number(g && g.min)) ? Number(g.min) : 0);
        const max = type === 'variant'
          ? 1
          : (g && g.max != null && Number.isInteger(Number(g.max)) && Number(g.max) >= 0 ? Number(g.max) : null);

        return {
          id: groupId,
          name: String((g && g.name) || `Pilihan ${gi + 1}`).trim(),
          type,
          required,
          min,
          max,
          options: options.map((o, oi) => ({
            id: String((o && o.id) || `option_${gi + 1}_${oi + 1}`).trim(),
            name: String((o && o.name) || `Pilihan ${oi + 1}`).trim(),
            price_adjustment: Number.isFinite(Number(o && o.price_adjustment)) ? Number(o.price_adjustment) : 0
          }))
        };
      })
    };
  }

  static validateConfig(raw) {
    const config = this.normalizeConfig(raw);
    if (config.groups.length > 10) throw new Error('Maksimal 10 option group per produk.');

    const groupIds = new Set();
    for (const group of config.groups) {
      if (!group.id || !group.name) throw new Error('Setiap option group wajib memiliki id dan nama.');
      if (groupIds.has(group.id)) throw new Error(`Option group "${group.id}" duplikat.`);
      groupIds.add(group.id);
      if (!['variant', 'addon'].includes(group.type)) throw new Error('Tipe option group hanya variant atau addon.');
      if (!Array.isArray(group.options) || group.options.length === 0) throw new Error(`Option group "${group.name}" harus memiliki minimal satu pilihan.`);
      if (group.type === 'variant' && group.options.length > 50) throw new Error(`Variant group "${group.name}" terlalu banyak pilihan.`);
      if (group.type === 'addon' && group.options.length > 50) throw new Error(`Add-on group "${group.name}" terlalu banyak pilihan.`);
      if (group.max != null && group.max < group.min) throw new Error(`Batas pilihan group "${group.name}" tidak valid.`);
      if (group.min > group.options.length) throw new Error(`Minimum pilihan pada "${group.name}" melebihi jumlah opsi yang tersedia.`);
      if (group.max != null && group.max > group.options.length) throw new Error(`Maksimum pilihan pada "${group.name}" melebihi jumlah opsi yang tersedia.`);

      const optionIds = new Set();
      for (const option of group.options) {
        if (!option.id || !option.name) throw new Error(`Pilihan dalam "${group.name}" wajib memiliki id dan nama.`);
        if (optionIds.has(option.id)) throw new Error(`Pilihan "${option.id}" duplikat dalam group "${group.name}".`);
        optionIds.add(option.id);
        if (!Number.isFinite(option.price_adjustment)) throw new Error(`Harga pilihan "${option.name}" tidak valid.`);
      }
    }

    return config;
  }

  static resolveSelections(productOptions, selections = []) {
    const config = this.validateConfig(productOptions);
    if (!Array.isArray(selections)) throw new Error('Pilihan option harus berupa array.');

    const requested = selections.map((s) => ({
      group_id: String((s && (s.group_id || s.groupId)) || '').trim(),
      option_id: String((s && (s.option_id || s.optionId)) || '').trim()
    })).filter((s) => s.group_id && s.option_id);

    const byGroup = new Map();
    for (const item of requested) {
      if (!byGroup.has(item.group_id)) byGroup.set(item.group_id, []);
      byGroup.get(item.group_id).push(item.option_id);
    }

    for (const group of config.groups) {
      const selected = byGroup.get(group.id) || [];
      const uniqueSelected = Array.from(new Set(selected));
      if (group.type === 'variant') {
        if (uniqueSelected.length > 1) throw new Error(`Group "${group.name}" hanya boleh memilih satu pilihan.`);
        if (group.required && uniqueSelected.length !== 1) throw new Error(`Pilihan "${group.name}" wajib dipilih.`);
      } else {
        if (uniqueSelected.length < group.min) throw new Error(`Minimal ${group.min} pilihan harus dipilih pada "${group.name}".`);
        if (group.max != null && uniqueSelected.length > group.max) throw new Error(`Maksimal ${group.max} pilihan dapat dipilih pada "${group.name}".`);
      }

      const validIds = new Set(group.options.map((o) => o.id));
      for (const optionId of uniqueSelected) {
        if (!validIds.has(optionId)) throw new Error(`Pilihan option tidak valid pada group "${group.name}".`);
      }
    }

    for (const groupId of byGroup.keys()) {
      if (!config.groups.some((g) => g.id === groupId)) {
        throw new Error('Option group tidak valid untuk produk ini.');
      }
    }

    const snapshot = [];
    let adjustment = 0;
    for (const group of config.groups) {
      const selectedIds = Array.from(new Set(byGroup.get(group.id) || []));
      for (const optionId of selectedIds) {
        const option = group.options.find((o) => o.id === optionId);
        adjustment += option.price_adjustment;
        snapshot.push({
          group_id: group.id,
          group_name: group.name,
          type: group.type,
          option_id: option.id,
          option_name: option.name,
          price_adjustment: option.price_adjustment
        });
      }
    }

    return { config, snapshot, adjustment };
  }
}

module.exports = ProductOptionsModel;
