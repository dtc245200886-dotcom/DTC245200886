const express = require('express');
const pool = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Endpoint kiểm tra sức khỏe dịch vụ
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'UP', timestamp: new Date() });
});

// 1. CREATE: Tạo chuyến đi mới
app.post('/api/rides', async (req, res) => {
  const { customer_name, pickup_location, dropoff_location } = req.body;
  if (!customer_name || !pickup_location || !dropoff_location) {
    return res.status(400).json({ error: 'Vui lòng điền đầy đủ thông tin chuyến đi' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO rides (customer_name, pickup_location, dropoff_location) 
       VALUES ($1, $2, $3) RETURNING *`,
      [customer_name, pickup_location, dropoff_location]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[API Error]', err.message);
    res.status(500).json({ error: 'Lỗi hệ thống máy chủ' });
  }
});

// 2. READ: Lấy danh sách tất cả chuyến đi
app.get('/api/rides', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM rides ORDER BY created_at DESC');
    res.json(result.rows);
  } catch (err) {
    console.error('[API Error]', err.message);
    res.status(500).json({ error: 'Lỗi hệ thống máy chủ' });
  }
});

// 3. UPDATE: Cập nhật trạng thái chuyến đi / Phân công tài xế
app.put('/api/rides/:id', async (req, res) => {
  const { id } = req.params;
  const { driver_name, status } = req.body;

  try {
    const result = await pool.query(
      `UPDATE rides 
       SET driver_name = COALESCE($1, driver_name), 
           status = COALESCE($2, status) 
       WHERE id = $3 RETURNING *`,
      [driver_name, status, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Không tìm thấy chuyến đi' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('[API Error]', err.message);
    res.status(500).json({ error: 'Lỗi hệ thống máy chủ' });
  }
});

// 4. DELETE: Hủy / Xóa chuyến đi
app.delete('/api/rides/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query('DELETE FROM rides WHERE id = $1 RETURNING *', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Không tìm thấy chuyến đi' });
    }
    res.json({ message: 'Đã xóa chuyến đi thành công', deleted: result.rows[0] });
  } catch (err) {
    console.error('[API Error]', err.message);
    res.status(500).json({ error: 'Lỗi hệ thống máy chủ' });
  }
});

app.listen(PORT, () => {
  console.log(`[App] Taxi Booking Service đang chạy trên port ${PORT}`);
});