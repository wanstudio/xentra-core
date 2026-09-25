      settled_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (order_id) REFERENCES orders(id)
    );

    CREATE TABLE IF NOT EXISTS pos_order_checks (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL,
      check_number INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      allocated_amount REAL NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
      UNIQUE (order_id, check_number)
    );
    CREATE INDEX IF NOT EXISTS idx_pos_order_checks_order ON pos_order_checks(order_id, status);

    CREATE TABLE IF NOT EXISTS pos_order_check_items (
      id TEXT PRIMARY KEY,
      check_id TEXT NOT NULL,
      order_item_id TEXT NOT NULL,
      quantity INTEGER NOT NULL CHECK (quantity > 0),
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (check_id) REFERENCES pos_order_checks(id) ON DELETE CASCADE,
      FOREIGN KEY (order_item_id) REFERENCES order_items(id) ON DELETE CASCADE,
      UNIQUE (check_id, order_item_id)
    );
    CREATE INDEX IF NOT EXISTS idx_pos_order_check_items_item ON pos_order_check_items(order_item_id);

    CREATE TABLE IF NOT EXISTS pos_check_payments (
      id TEXT PRIMARY KEY,
      check_id TEXT NOT NULL,
      order_id TEXT NOT NULL,
      payment_method TEXT NOT NULL,
      provider TEXT NOT NULL,
      amount REAL NOT NULL CHECK (amount > 0),
      payment_status TEXT NOT NULL DEFAULT 'settlement',
      payer_name TEXT,
      actor_id TEXT,
      raw_payment TEXT,
      settled_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (check_id) REFERENCES pos_order_checks(id) ON DELETE CASCADE,
      FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_pos_check_payments_check ON pos_check_payments(check_id, payment_status);
    CREATE INDEX IF NOT EXISTS idx_pos_check_payments_order ON pos_check_payments(order_id, payment_status);

  try { targetDb.exec('ALTER TABLE pos_order_checks ADD COLUMN allocated_amount REAL NOT NULL DEFAULT 0;'); } catch (e) {}
