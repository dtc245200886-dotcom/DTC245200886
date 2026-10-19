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
    CREATE TABLE IF NOT EXISTS rides (
      id SERIAL PRIMARY KEY,
      customer_name VARCHAR(100) NOT NULL,
      driver_name VARCHAR(100),
      pickup_location VARCHAR(255) NOT NULL,
      dropoff_location VARCHAR(255) NOT NULL,
      status VARCHAR(50) DEFAULT 'PENDING',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `;
  try {
    await pool.query(queryText);
    console.log('[DB] Đã khởi tạo bảng rides thành công.');
  } catch (err) {
    console.error('[DB] Lỗi khi khởi tạo bảng:', err.message);
  }
};

initDb();

module.exports = pool;