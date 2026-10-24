const express = require('express');
const path = require('path'); // <--- 1. Thêm thư viện path chuẩn của Node.js
const { createHash, randomBytes, timingSafeEqual } = require('crypto');
const pool = require('./db');
const client = require('prom-client');
const { VEHICLE_TARIFFS, estimateTrip, isValidCoordinate } = require('./pricing');

const app = express();
const PORT = process.env.PORT || 3000;
const PROMETHEUS_URL = process.env.PROMETHEUS_URL || 'http://prometheus:9090';
const LOKI_URL = process.env.LOKI_URL || 'http://loki:3100';
const ADMIN_USER = process.env.ADMIN_USER || '';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const register = new client.Registry();

client.collectDefaultMetrics({ register });

const httpRequests = new client.Counter({
  name: 'taxi_http_requests_total',
  help: 'Total number of HTTP requests handled by the taxi booking app',
  labelNames: ['method', 'route', 'status_code'],
  registers: [register],
});

const httpRequestDuration = new client.Histogram({
  name: 'taxi_http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route', 'status_code'],
  registers: [register],
});

app.use(express.json({ limit: '32kb' }));

app.use((req, res, next) => {
  const startedAt = process.hrtime.bigint();
  res.on('finish', () => {
    const route = req.route?.path
      ? `${req.baseUrl}${req.route.path}`
      : req.path.startsWith('/api/') ? 'unmatched_api' : req.path;
    const labels = { method: req.method, route, status_code: String(res.statusCode) };
    httpRequests.inc(labels);
    httpRequestDuration.observe(labels, Number(process.hrtime.bigint() - startedAt) / 1e9);
  });
  next();
});

app.get('/metrics', async (req, res) => {
  try {
    res.set('Content-Type', register.contentType);
    res.end(await register.metrics());
  } catch (err) {
    console.error('[Metrics Error]', err.message);
    res.sendStatus(500);
  }
});

app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.status(200).json({ status: 'UP', timestamp: new Date() });
  } catch (err) {
    res.status(503).json({ status: 'DOWN', timestamp: new Date() });
  }
});

app.use(express.static(path.join(__dirname, 'public')));

function requireAdmin(req, res, next) {
  const authorization = req.get('authorization') || '';
  const match = authorization.length <= 4096 && authorization.match(/^Basic\s+([A-Za-z0-9+/=]+)$/i);
  if (match && ADMIN_USER && ADMIN_PASSWORD) {
    try {
      const decoded = Buffer.from(match[1], 'base64').toString('utf8');
      const separator = decoded.indexOf(':');
      if (separator >= 0) {
        const username = Buffer.from(decoded.slice(0, separator));
        const password = Buffer.from(decoded.slice(separator + 1));
        const expectedUsername = Buffer.from(ADMIN_USER);
        const expectedPassword = Buffer.from(ADMIN_PASSWORD);
        const validUsername = username.length === expectedUsername.length && timingSafeEqual(username, expectedUsername);
        const validPassword = password.length === expectedPassword.length && timingSafeEqual(password, expectedPassword);
        if (validUsername && validPassword) return next();
      }
    } catch (err) {
      console.warn('[Auth] Invalid admin authorization header');
    }
  }

  res.set('WWW-Authenticate', 'Basic realm="Taxi Booking Admin", charset="UTF-8"');
  res.status(401).json({ error: 'Cần đăng nhập quản trị để tiếp tục' });
}

app.get('/api/drivers', requireAdmin, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM drivers ORDER BY is_active DESC, name ASC');
    res.json(result.rows);
  } catch (err) {
    console.error('[API Error]', err.message);
    res.status(500).json({ error: 'Lỗi hệ thống máy chủ' });
  }
});

app.post('/api/drivers', requireAdmin, async (req, res) => {
  const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
  const phone = typeof req.body.phone === 'string' ? req.body.phone.trim() : null;
  if (!name || name.length > 100 || (phone && phone.length > 30)) {
    return res.status(400).json({ error: 'Tên tài xế hoặc số điện thoại không hợp lệ' });
  }

  try {
    const result = await pool.query(
      'INSERT INTO drivers (name, phone) VALUES ($1, $2) RETURNING *',
      [name, phone || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Tên tài xế đã tồn tại' });
    console.error('[API Error]', err.message);
    res.status(500).json({ error: 'Lỗi hệ thống máy chủ' });
  }
});

app.put('/api/drivers/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { name, phone, is_active } = req.body;
  if (name !== undefined && (typeof name !== 'string' || !name.trim() || name.trim().length > 100)) {
    return res.status(400).json({ error: 'Tên tài xế không hợp lệ' });
  }
  if (phone !== undefined && phone !== null && (typeof phone !== 'string' || phone.trim().length > 30)) {
    return res.status(400).json({ error: 'Số điện thoại không hợp lệ' });
  }
  if (is_active !== undefined && typeof is_active !== 'boolean') {
    return res.status(400).json({ error: 'Trạng thái tài xế không hợp lệ' });
  }

  try {
    const result = await pool.query(
      `UPDATE drivers SET name = COALESCE($1, name), phone = COALESCE($2, phone),
       is_active = COALESCE($3, is_active) WHERE id = $4 RETURNING *`,
      [name?.trim() || null, phone?.trim() || null, is_active ?? null, id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Không tìm thấy tài xế' });
    res.json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Tên tài xế đã tồn tại' });
    console.error('[API Error]', err.message);
    res.status(500).json({ error: 'Lỗi hệ thống máy chủ' });
  }
});

app.get('/api/customers', requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT customers.id, customers.name, customers.phone,
       COUNT(rides.id)::INTEGER AS ride_count, MAX(rides.created_at) AS last_ride_at
       FROM customers LEFT JOIN rides ON rides.customer_id = customers.id
       GROUP BY customers.id ORDER BY MAX(rides.created_at) DESC NULLS LAST, customers.name ASC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[API Error]', err.message);
    res.status(500).json({ error: 'Lỗi hệ thống máy chủ' });
  }
});

app.put('/api/customers/:id', requireAdmin, async (req, res) => {
  const hasName = Object.hasOwn(req.body, 'name');
  const hasPhone = Object.hasOwn(req.body, 'phone');
  const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
  const phone = typeof req.body.phone === 'string' ? req.body.phone.trim() : req.body.phone;
  if (!hasName && !hasPhone) return res.status(400).json({ error: 'Không có thông tin khách hàng cần cập nhật' });
  if (hasName && (!name || name.length > 100)) return res.status(400).json({ error: 'Tên khách hàng không hợp lệ' });
  if (hasPhone && phone !== null && (typeof phone !== 'string' || phone.length > 30)) {
    return res.status(400).json({ error: 'Số điện thoại không hợp lệ' });
  }

  const dbClient = await pool.connect();
  try {
    await dbClient.query('BEGIN');
    const result = await dbClient.query(
      `UPDATE customers SET name = CASE WHEN $1 THEN $2 ELSE name END,
       phone = CASE WHEN $3 THEN $4 ELSE phone END WHERE id = $5 RETURNING *`,
      [hasName, name, hasPhone, phone || null, req.params.id]
    );
    if (!result.rows.length) {
      await dbClient.query('ROLLBACK');
      return res.status(404).json({ error: 'Không tìm thấy khách hàng' });
    }
    if (hasName) await dbClient.query('UPDATE rides SET customer_name = $1 WHERE customer_id = $2', [name, req.params.id]);
    await dbClient.query('COMMIT');
    res.json(result.rows[0]);
  } catch (err) {
    await dbClient.query('ROLLBACK').catch(() => {});
    if (err.code === '23505') return res.status(409).json({ error: 'Số điện thoại đã được dùng cho khách khác' });
    console.error('[API Error]', err.message);
    res.status(500).json({ error: 'Lỗi hệ thống máy chủ' });
  } finally {
    dbClient.release();
  }
});

app.get('/api/observability', requireAdmin, async (req, res) => {
  const queries = {
    cpu: '100 * (1 - avg(rate(node_cpu_seconds_total{mode="idle"}[5m])))',
    memory: '100 * (1 - sum(node_memory_MemAvailable_bytes) / sum(node_memory_MemTotal_bytes))',
    requests: 'sum(rate(taxi_http_requests_total[5m]))',
    latency: '1000 * histogram_quantile(0.95, sum by (le) (rate(taxi_http_request_duration_seconds_bucket[5m])))',
    containers: 'count(count by (container_label_com_docker_compose_service) (container_last_seen{container_label_com_docker_compose_project="taxi-booking"} > time() - 60))',
    targets: 'sum(up)',
    targetCount: 'count(up)',
  };

  try {
    const metrics = await Promise.all(Object.entries(queries).map(async ([name, query]) => {
      const response = await fetch(`${PROMETHEUS_URL}/api/v1/query?query=${encodeURIComponent(query)}`);
      if (!response.ok) throw new Error(`Prometheus query failed: ${name}`);
      const result = await response.json();
      return [name, Number(result.data.result[0]?.value[1] || 0)];
    }));
    res.json(Object.fromEntries(metrics));
  } catch (err) {
    console.error('[Metrics Error]', err.message);
    res.status(503).json({ error: 'Không lấy được metrics từ Prometheus' });
  }
});

app.get('/api/observability/logs', requireAdmin, async (req, res) => {
  try {
    const end = BigInt(Date.now()) * 1_000_000n;
    const params = new URLSearchParams({
      query: '{job="taxi-booking",container_name="taxi-web-app"}',
      start: (end - 1_800_000_000_000n).toString(),
      end: end.toString(),
      limit: '40',
      direction: 'BACKWARD',
    });
    const response = await fetch(`${LOKI_URL}/loki/api/v1/query_range?${params}`);
    if (!response.ok) throw new Error(`Loki query failed with ${response.status}`);
    const result = await response.json();
    const logs = result.data.result.flatMap(stream => stream.values.map(([timestamp, line]) => ({
      timestamp,
      line,
    }))).sort((left, right) => left.timestamp < right.timestamp ? 1 : -1);
    res.json(logs.slice(0, 40));
  } catch (err) {
    console.error('[Logs Error]', err.message);
    res.status(503).json({ error: 'Không lấy được log từ Loki' });
  }
});

// 1. CREATE: Tạo chuyến đi mới
app.get('/api/estimates/ride', (req, res) => {
  const pickup = [Number(req.query.pickup_latitude), Number(req.query.pickup_longitude)];
  const dropoff = [Number(req.query.dropoff_latitude), Number(req.query.dropoff_longitude)];
  if (!isValidCoordinate(...pickup) || !isValidCoordinate(...dropoff)) {
    return res.status(400).json({ error: 'Tọa độ điểm đón hoặc điểm đến không hợp lệ' });
  }

  const vehicles = Object.keys(VEHICLE_TARIFFS).map(vehicleType => [
    vehicleType,
    estimateTrip(pickup, dropoff, vehicleType),
  ]);
  res.json({ vehicles: Object.fromEntries(vehicles) });
});

app.post('/api/rides', async (req, res) => {
  const customer_name = typeof req.body.customer_name === 'string' ? req.body.customer_name.trim() : '';
  const customer_phone = typeof req.body.customer_phone === 'string' ? req.body.customer_phone.trim() : '';
  const pickup_location = typeof req.body.pickup_location === 'string' ? req.body.pickup_location.trim() : '';
  const dropoff_location = typeof req.body.dropoff_location === 'string' ? req.body.dropoff_location.trim() : '';
  const pickup = [req.body.pickup_latitude, req.body.pickup_longitude];
  const dropoff = [req.body.dropoff_latitude, req.body.dropoff_longitude];
  const vehicle_type = req.body.vehicle_type || 'standard';
  const vehicleTypes = ['standard', 'premium', 'xl', 'bike'];
  if (!customer_name || customer_name.length > 100 || customer_phone.length > 30 || !pickup_location || pickup_location.length > 255 || !dropoff_location || dropoff_location.length > 255) {
    return res.status(400).json({ error: 'Tên khách và địa điểm phải hợp lệ, không vượt quá giới hạn cho phép' });
  }
  if (!vehicleTypes.includes(vehicle_type)) {
    return res.status(400).json({ error: 'Loại xe không hợp lệ' });
  }
  if (!isValidCoordinate(...pickup) || !isValidCoordinate(...dropoff)) {
    return res.status(400).json({ error: 'Hãy chọn điểm đón và điểm đến trên bản đồ hoặc từ lộ trình có sẵn' });
  }
  const estimate = estimateTrip(pickup, dropoff, vehicle_type);
  const cancellationToken = randomBytes(32).toString('base64url');
  const cancellationTokenHash = createHash('sha256').update(cancellationToken).digest('hex');

  const dbClient = await pool.connect();
  try {
    await dbClient.query('BEGIN');
    let customerResult;
    if (customer_phone) {
      customerResult = await dbClient.query(
        `INSERT INTO customers (name, phone) VALUES ($1, $2)
         ON CONFLICT (phone) WHERE phone IS NOT NULL
         DO UPDATE SET name = EXCLUDED.name RETURNING id`,
        [customer_name, customer_phone]
      );
    } else {
      customerResult = await dbClient.query(
        'SELECT id FROM customers WHERE phone IS NULL AND LOWER(name) = LOWER($1) ORDER BY id LIMIT 1',
        [customer_name]
      );
      if (!customerResult.rows.length) {
        customerResult = await dbClient.query('INSERT INTO customers (name) VALUES ($1) RETURNING id', [customer_name]);
      }
    }

    const result = await dbClient.query(
      `INSERT INTO rides (customer_id, customer_name, pickup_location, dropoff_location,
       pickup_latitude, pickup_longitude, dropoff_latitude, dropoff_longitude,
       estimated_distance_km, estimated_fare, estimated_duration_min, vehicle_type, cancellation_token_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING id, customer_id, customer_name, driver_id, driver_name, pickup_location, dropoff_location,
       pickup_latitude, pickup_longitude, dropoff_latitude, dropoff_longitude,
       estimated_distance_km, estimated_fare, estimated_duration_min, vehicle_type, status, created_at`,
      [customerResult.rows[0].id, customer_name, pickup_location, dropoff_location,
        ...pickup, ...dropoff, estimate.distanceKm, estimate.fare, estimate.durationMinutes,
        vehicle_type, cancellationTokenHash]
    );
    await dbClient.query('COMMIT');
    res.status(201).json({ ...result.rows[0], cancellation_token: cancellationToken });
  } catch (err) {
    await dbClient.query('ROLLBACK').catch(() => {});
    if (err.code === '23505') return res.status(409).json({ error: 'Số điện thoại đã được dùng cho khách khác' });
    console.error('[API Error]', err.message);
    res.status(500).json({ error: 'Lỗi hệ thống máy chủ' });
  } finally {
    dbClient.release();
  }
});

app.post('/api/rides/:id/cancel', async (req, res) => {
  const token = typeof req.body.token === 'string' ? req.body.token : '';
  if (token.length < 32 || token.length > 128) return res.status(400).json({ error: 'Mã hủy chuyến không hợp lệ' });

  const tokenHash = createHash('sha256').update(token).digest('hex');
  try {
    const result = await pool.query(
      `UPDATE rides SET status = 'CANCELLED'
       WHERE id = $1 AND cancellation_token_hash = $2 AND status IN ('PENDING', 'ASSIGNED')
       RETURNING id, status`,
      [req.params.id, tokenHash]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Không tìm thấy yêu cầu có thể hủy' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[API Error]', err.message);
    res.status(500).json({ error: 'Lỗi hệ thống máy chủ' });
  }
});

// 2. READ: Lấy danh sách tất cả chuyến đi
app.get('/api/rides', requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, customer_id, customer_name, driver_id, driver_name, pickup_location, dropoff_location,
       pickup_latitude, pickup_longitude, dropoff_latitude, dropoff_longitude,
       estimated_distance_km, estimated_fare, estimated_duration_min, vehicle_type, status, created_at
       FROM rides ORDER BY created_at DESC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[API Error]', err.message);
    res.status(500).json({ error: 'Lỗi hệ thống máy chủ' });
  }
});

// 3. UPDATE: Cập nhật trạng thái chuyến đi / Phân công tài xế
app.put('/api/rides/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { driver_name, status } = req.body;
  const hasDriverId = Object.hasOwn(req.body, 'driver_id');
  const driverId = req.body.driver_id;
  const allowedStatuses = ['PENDING', 'ASSIGNED', 'ACCEPTED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'];
  if (status !== undefined && !allowedStatuses.includes(status)) {
    return res.status(400).json({ error: 'Trạng thái chuyến đi không hợp lệ' });
  }
  if (hasDriverId && driverId !== null && (!Number.isInteger(Number(driverId)) || Number(driverId) < 1)) {
    return res.status(400).json({ error: 'Mã tài xế không hợp lệ' });
  }

  try {
    let result;
    if (hasDriverId) {
      let assignedDriver = null;
      if (driverId !== null) {
        const driverResult = await pool.query('SELECT id, name FROM drivers WHERE id = $1 AND is_active = TRUE', [driverId]);
        if (driverResult.rows.length === 0) return res.status(400).json({ error: 'Không tìm thấy tài xế đang hoạt động' });
        assignedDriver = driverResult.rows[0];
      }
      result = await pool.query(
        `UPDATE rides SET driver_id = $1, driver_name = $2, status = $3
         WHERE id = $4 RETURNING *`,
        [assignedDriver?.id || null, assignedDriver?.name || null, status || (assignedDriver ? 'ASSIGNED' : 'PENDING'), id]
      );
    } else {
      result = await pool.query(
        `UPDATE rides SET driver_name = COALESCE($1, driver_name), status = COALESCE($2, status)
         WHERE id = $3 RETURNING *`,
        [driver_name, status, id]
      );
    }

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
app.delete('/api/rides/:id', requireAdmin, async (req, res) => {
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

pool.initialization
  .then(() => {
    app.listen(PORT, () => {
      console.log(`[App] Taxi Booking Service đang chạy trên port ${PORT}`);
    });
  })
  .catch(() => {
    process.exit(1);
  });