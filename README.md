# Đồ Án Đề 22: Hệ Thống Giám Sát & Log Tập Trung Cho Ứng Dụng Taxi Booking

Hệ thống được đóng gói hoàn toàn bằng Docker Compose, phân tách 3 lớp mạng an toàn (Frontend, Backend, Monitoring) giúp theo dõi hiệu năng và quản lý log thời gian thực.

## 🏗 Kiến Trúc Hệ Thống (9 Services)

1. **Ứng dụng & Dữ liệu:** `taxi-web-app` (Node.js), `postgres-db` (PostgreSQL)
2. **Reverse Proxy:** `nginx-proxy` (Nginx)
3. **Giám sát Metrics:** `prometheus`, `node-exporter`, `cadvisor`, `grafana`
4. **Quản lý Log tập trung:** `loki`, `promtail`

## 🚀 Hướng Dẫn Triển Khai Chạy Nhanh

### 1. Khởi động hệ thống
```bash
docker-compose up -d --build