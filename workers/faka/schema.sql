-- Issue Englisher 发卡系统 D1 数据库结构

-- 卡密表：存储所有可用的 Pro 令牌
CREATE TABLE IF NOT EXISTS cards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token TEXT NOT NULL UNIQUE,
  plan TEXT NOT NULL DEFAULT 'pro',
  tier TEXT NOT NULL DEFAULT 'standard',
  valid_days INTEGER NOT NULL DEFAULT 30,
  generate_quota INTEGER NOT NULL DEFAULT 200,
  expand_quota INTEGER NOT NULL DEFAULT 50,
  used INTEGER NOT NULL DEFAULT 0,
  order_no TEXT,
  buyer_contact TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  used_at DATETIME
);

-- 订单记录表（可选，用于追踪）
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_no TEXT NOT NULL UNIQUE,
  amount REAL NOT NULL,
  plan TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  card_id INTEGER,
  buyer_contact TEXT,
  payment_method TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  completed_at DATETIME,
  FOREIGN KEY (card_id) REFERENCES cards(id)
);

-- 创建索引
CREATE INDEX IF NOT EXISTS idx_cards_plan ON cards(plan);
CREATE INDEX IF NOT EXISTS idx_cards_used ON cards(used);
CREATE INDEX IF NOT EXISTS idx_cards_order_no ON cards(order_no);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
