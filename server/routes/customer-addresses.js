/**
 * XENTRA CORE — CUSTOMER ADDRESS ROUTES
 *
 * Customer-owned address CRUD. Ownership and tenant scope remain enforced by
 * the existing requireCustomerAuth middleware plus brand/customer identifiers.
 */
module.exports = function registerCustomerAddressRoutes(router, deps) {
  const { db, crypto, requireCustomerAuth } = deps;

router.get('/addresses', requireCustomerAuth(), (req, res) => {
  try {
    const customerPhone = req.customer.phone;
    const customerId = req.customer.customerId || req.customer.customer_id;
    let addresses;
    if (customerId) {
      // Canonical ownership: addresses strictly belong to customer_id within the requested brand
      addresses = db.prepare(`
        SELECT * FROM customer_addresses 
        WHERE brand_id = ? AND customer_id = ?
        ORDER BY is_primary DESC, updated_at DESC, created_at DESC
      `).all(req.brand_id, customerId);
    } else {
      // Legacy fallback: unlinked addresses without customer_id
      addresses = db.prepare(`
        SELECT * FROM customer_addresses 
        WHERE brand_id = ? AND customer_id IS NULL AND customer_phone = ? 
        ORDER BY is_primary DESC, updated_at DESC, created_at DESC
      `).all(req.brand_id, customerPhone);
    }

    res.json({ success: true, addresses: addresses || [] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/addresses', requireCustomerAuth(), (req, res) => {
  try {
    const { label = 'Rumah', address = '', detail = '', note = '', latitude, longitude, is_primary } = req.body;
    const customerPhone = req.customer.phone;
    const customerId = req.customer.customerId || req.customer.customer_id || null;

    if (latitude == null || longitude == null || isNaN(Number(latitude)) || isNaN(Number(longitude))) {
      return res.status(400).json({
        success: false,
        error: 'Titik koordinat (latitude & longitude) wajib diisi dengan angka yang valid.'
      });
    }

    if (!address || !String(address).trim()) {
      return res.status(400).json({
        success: false,
        error: 'Alamat lengkap wajib diisi.'
      });
    }

    const addrId = 'addr_' + crypto.randomBytes(6).toString('hex');
    const existingCount = customerId
      ? db.prepare('SELECT COUNT(*) as cnt FROM customer_addresses WHERE brand_id = ? AND customer_id = ?').get(req.brand_id, customerId)
      : db.prepare('SELECT COUNT(*) as cnt FROM customer_addresses WHERE brand_id = ? AND customer_id IS NULL AND customer_phone = ?').get(req.brand_id, customerPhone);
    
    let isPrimary = 0;
    if (is_primary !== undefined) {
      isPrimary = (is_primary === 1 || is_primary === true || is_primary === '1') ? 1 : 0;
    } else {
      isPrimary = (!existingCount || existingCount.cnt === 0) ? 1 : 0;
    }

    // If marked as primary, demote any existing primary addresses for this customer & brand
    if (isPrimary === 1) {
      if (customerId) {
        db.prepare('UPDATE customer_addresses SET is_primary = 0 WHERE brand_id = ? AND customer_id = ?').run(req.brand_id, customerId);
      } else {
        db.prepare('UPDATE customer_addresses SET is_primary = 0 WHERE brand_id = ? AND customer_id IS NULL AND customer_phone = ?').run(req.brand_id, customerPhone);
      }
    }

    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO customer_addresses (
        id, brand_id, customer_id, customer_phone, label, address, detail, note, latitude, longitude, is_primary, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      addrId,
      req.brand_id,
      customerId,
      customerPhone,
      (label || 'Rumah').trim(),
      String(address).trim(),
      (detail || '').trim(),
      (note || '').trim(),
      Number(latitude),
      Number(longitude),
      isPrimary,
      now,
      now
    );

    const created = {
      id: addrId,
      brand_id: req.brand_id,
      customer_id: customerId,
      customer_phone: customerPhone,
      label: (label || 'Rumah').trim(),
      address: String(address).trim(),
      detail: (detail || '').trim(),
      note: (note || '').trim(),
      latitude: Number(latitude),
      longitude: Number(longitude),
      is_primary: isPrimary,
      created_at: now,
      updated_at: now
    };

    res.status(201).json({ success: true, address: created });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.put('/addresses/:id', requireCustomerAuth(), (req, res) => {
  try {
    const customerPhone = req.customer.phone;
    const customerId = req.customer.customerId || req.customer.customer_id;
    const existing = customerId
      ? db.prepare('SELECT * FROM customer_addresses WHERE id = ? AND brand_id = ? AND customer_id = ?').get(req.params.id, req.brand_id, customerId)
      : db.prepare('SELECT * FROM customer_addresses WHERE id = ? AND brand_id = ? AND customer_id IS NULL AND customer_phone = ?').get(req.params.id, req.brand_id, customerPhone);
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Alamat tidak ditemukan atau Anda tidak memiliki akses.' });
    }

    const { label, address, detail, note, latitude, longitude, is_primary } = req.body;

    const newLabel = label !== undefined ? String(label).trim() : existing.label;
    const newAddress = address !== undefined ? String(address).trim() : existing.address;
    const newDetail = detail !== undefined ? String(detail).trim() : existing.detail;
    const newNote = note !== undefined ? String(note).trim() : existing.note;

    if (newAddress === '') {
      return res.status(400).json({ success: false, error: 'Alamat lengkap tidak boleh kosong.' });
    }

    let newLat = existing.latitude;
    let newLng = existing.longitude;
    if (latitude !== undefined) {
      if (latitude == null || isNaN(Number(latitude))) {
        return res.status(400).json({ success: false, error: 'Latitude harus berupa angka valid.' });
      }
      newLat = Number(latitude);
    }
    if (longitude !== undefined) {
      if (longitude == null || isNaN(Number(longitude))) {
        return res.status(400).json({ success: false, error: 'Longitude harus berupa angka valid.' });
      }
      newLng = Number(longitude);
    }

    let newIsPrimary = existing.is_primary;
    if (is_primary !== undefined) {
      newIsPrimary = (is_primary === 1 || is_primary === true || is_primary === '1') ? 1 : 0;
      if (newIsPrimary === 1) {
        if (customerId) {
          db.prepare('UPDATE customer_addresses SET is_primary = 0 WHERE brand_id = ? AND customer_id = ? AND id != ?').run(req.brand_id, customerId, req.params.id);
        } else {
          db.prepare('UPDATE customer_addresses SET is_primary = 0 WHERE brand_id = ? AND customer_id IS NULL AND customer_phone = ? AND id != ?').run(req.brand_id, customerPhone, req.params.id);
        }
      }
    }

    const now = new Date().toISOString();
    db.prepare(`
      UPDATE customer_addresses
      SET label = ?, address = ?, detail = ?, note = ?, latitude = ?, longitude = ?, is_primary = ?, updated_at = ?
      WHERE id = ? AND brand_id = ?
    `).run(
      newLabel,
      newAddress,
      newDetail,
      newNote,
      newLat,
      newLng,
      newIsPrimary,
      now,
      req.params.id,
      req.brand_id
    );

    const updated = {
      id: req.params.id,
      brand_id: req.brand_id,
      customer_id: existing.customer_id || customerId,
      customer_phone: customerPhone,
      label: newLabel,
      address: newAddress,
      detail: newDetail,
      note: newNote,
      latitude: newLat,
      longitude: newLng,
      is_primary: newIsPrimary,
      created_at: existing.created_at,
      updated_at: now
    };

    res.json({ success: true, address: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.delete('/addresses/:id', requireCustomerAuth(), (req, res) => {
  try {
    const customerPhone = req.customer.phone;
    const customerId = req.customer.customerId || req.customer.customer_id;
    const result = customerId
      ? db.prepare('DELETE FROM customer_addresses WHERE id = ? AND brand_id = ? AND customer_id = ?').run(req.params.id, req.brand_id, customerId)
      : db.prepare('DELETE FROM customer_addresses WHERE id = ? AND brand_id = ? AND customer_id IS NULL AND customer_phone = ?').run(req.params.id, req.brand_id, customerPhone);
    if (result.changes === 0) {
      return res.status(404).json({ success: false, error: 'Alamat tidak ditemukan atau Anda tidak memiliki akses.' });
    }
    res.json({ success: true, message: 'Alamat berhasil dihapus.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});
};
