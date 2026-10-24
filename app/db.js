const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST || 'postgres',
  port: process.env.DB_PORT || 5432,
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres_password',
  database: process.env.DB_NAME || 'taxidb',
});

// Tự động khởi tạo bảng khi kết nối thành công
const initDb = async () => {
  const queryText = `
    CREATE TABLE IF NOT EXISTS drivers (
      id SERIAL PRIMARY KEY,
      name VARCHAR(100) NOT NULL UNIQUE,
      phone VARCHAR(30),
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS customers (
      id SERIAL PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      phone VARCHAR(30),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE UNIQUE INDEX IF NOT EXISTS customers_phone_unique
      ON customers (phone) WHERE phone IS NOT NULL;
    CREATE TABLE IF NOT EXISTS rides (
      id SERIAL PRIMARY KEY,
      customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
      customer_name VARCHAR(100) NOT NULL,
      driver_name VARCHAR(100),
      pickup_location VARCHAR(255) NOT NULL,
      dropoff_location VARCHAR(255) NOT NULL,
      pickup_latitude DOUBLE PRECISION,
      pickup_longitude DOUBLE PRECISION,
      dropoff_latitude DOUBLE PRECISION,
      dropoff_longitude DOUBLE PRECISION,
      estimated_distance_km DOUBLE PRECISION,
      estimated_fare INTEGER,
      estimated_duration_min INTEGER,
      cancellation_token_hash CHAR(64),
      vehicle_type VARCHAR(30) NOT NULL DEFAULT 'standard',
      status VARCHAR(50) DEFAULT 'PENDING',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    ALTER TABLE rides ADD COLUMN IF NOT EXISTS customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL;
    ALTER TABLE rides ADD COLUMN IF NOT EXISTS pickup_latitude DOUBLE PRECISION;
    ALTER TABLE rides ADD COLUMN IF NOT EXISTS pickup_longitude DOUBLE PRECISION;
    ALTER TABLE rides ADD COLUMN IF NOT EXISTS dropoff_latitude DOUBLE PRECISION;
    ALTER TABLE rides ADD COLUMN IF NOT EXISTS dropoff_longitude DOUBLE PRECISION;
    ALTER TABLE rides ADD COLUMN IF NOT EXISTS estimated_distance_km DOUBLE PRECISION;
    ALTER TABLE rides ADD COLUMN IF NOT EXISTS estimated_fare INTEGER;
    ALTER TABLE rides ADD COLUMN IF NOT EXISTS estimated_duration_min INTEGER;
    ALTER TABLE rides ADD COLUMN IF NOT EXISTS cancellation_token_hash CHAR(64);
    ALTER TABLE rides ADD COLUMN IF NOT EXISTS vehicle_type VARCHAR(30) NOT NULL DEFAULT 'standard';
    ALTER TABLE rides ADD COLUMN IF NOT EXISTS driver_id INTEGER REFERENCES drivers(id) ON DELETE SET NULL;
    INSERT INTO drivers (name, is_active)
      SELECT DISTINCT driver_name, FALSE FROM rides
      WHERE driver_name IS NOT NULL AND driver_name <> ''
      ON CONFLICT (name) DO NOTHING;
    UPDATE rides SET driver_id = drivers.id
      FROM drivers WHERE rides.driver_name = drivers.name AND rides.driver_id IS NULL;
    INSERT INTO customers (name)
      SELECT DISTINCT customer_name FROM rides
      WHERE customer_name IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM customers WHERE customers.name = rides.customer_name AND customers.phone IS NULL
      );
    UPDATE rides SET customer_id = customers.id
      FROM customers WHERE rides.customer_name = customers.name AND customers.phone IS NULL AND rides.customer_id IS NULL;
  `;
  try {
    await pool.query(queryText);
    console.log('[DB] Đã khởi tạo bảng rides thành công.');
  } catch (err) {
    console.error('[DB] Lỗi khi khởi tạo bảng:', err.message);
    throw err;
  }
};

const initialization = initDb();

module.exports = pool;
module.exports.initialization = initialization;