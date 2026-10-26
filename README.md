# Đồ án Đề 22: Hệ thống đặt xe Taxi Booking, giám sát và quản lý log tập trung.

Ứng dụng web đặt xe taxi và hệ thống vận hành được triển khai bằng Docker Compose. Các luồng mạng frontend, backend và monitoring được tách riêng.

## Các dịch vụ

Hệ thống gồm 11 dịch vụ:

1. `web-app`: Ứng dụng đặt xe Node.js/Express và cung cấp HTTP metrics.
2. `postgres`: Cơ sở dữ liệu PostgreSQL lưu chuyến đi, chỉ có thể truy cập qua mạng backend.
3. `pgadmin`: Giao diện quản trị PostgreSQL.
4. `nginx`: Reverse proxy HTTPS và chuyển hướng HTTP sang HTTPS.
5. `prometheus`: Thu thập metrics và cung cấp API truy vấn.
6. `node-exporter`: Thu thập metrics của máy chủ.
7. `cadvisor`: Thu thập metrics CPU và bộ nhớ của container.
8. `postgres-exporter`: Cung cấp trạng thái và metrics của PostgreSQL.
9. `grafana`: Được cấu hình sẵn datasource Prometheus, Loki và dashboard Taxi Booking.
10. `loki`: Lưu trữ log tập trung và cung cấp API LogQL.
11. `promtail`: Phát hiện log Docker và chuyển log đến Loki.

## Chức năng ứng dụng

- Tạo chuyến với tên/số điện thoại khách, điểm đón, điểm đến và loại xe; dữ liệu được lưu trong PostgreSQL.
- Quản lý hồ sơ khách hàng, lịch sử chuyến, danh sách tài xế, số điện thoại và trạng thái hoạt động.
- Phân công tài xế, cập nhật trạng thái chuyến và giữ yêu cầu đã hủy trong lịch sử.
- Tính cước, quãng đường và thời gian ước tính từ tọa độ; giá được máy chủ tính lại và lưu cùng chuyến.
- Tab giám sát lấy CPU, RAM, HTTP request, độ trễ p95 và số container đang chạy từ Prometheus; log gần đây được truy vấn từ Loki.

Quãng đường và thời gian là ước tính tham khảo từ khoảng cách tọa độ, chưa dùng dịch vụ định tuyến đường thực tế.

## Cấu hình và khởi động

Tạo file `.env` từ mẫu rồi thay toàn bộ mật khẩu mẫu bằng các giá trị riêng, đủ mạnh. Không commit `.env` lên Git.

```powershell
Copy-Item .env.example .env
```

Ứng dụng dùng `ADMIN_USER` và `ADMIN_PASSWORD` để bảo vệ API quản trị bằng HTTP Basic Authentication. Khi mở tab lịch sử, điều phối hoặc giám sát, trình duyệt sẽ yêu cầu tài khoản này. Grafana có tài khoản riêng qua `GRAFANA_ADMIN_USER` và `GRAFANA_ADMIN_PASSWORD`. Không dùng lại mật khẩu giữa các dịch vụ.

Tạo chứng chỉ tự ký để chạy local (cần cài OpenSSL):

```powershell
New-Item -ItemType Directory -Force nginx/ssl
openssl req -x509 -nodes -days 365 -newkey rsa:2048 -keyout nginx/ssl/selfsigned.key -out nginx/ssl/selfsigned.crt -subj "/CN=localhost"
```

Không dùng chứng chỉ tự ký khi triển khai production công khai.

Build và khởi động toàn bộ dịch vụ:

```bash
docker compose up -d --build
```

Kiểm tra trạng thái và log của các dịch vụ:

```bash
docker compose ps
docker compose logs -f web-app prometheus grafana loki promtail
```

Chạy kiểm thử công thức cước:

```bash
npm --prefix app test
```

## Truy cập

- Ứng dụng đặt xe: `https://localhost` (chấp nhận cảnh báo chứng chỉ tự ký khi chạy local).
- pgAdmin: `http://localhost:5050`.
- Prometheus: `http://localhost:9090`.
- Grafana: `http://localhost:3002` (dashboard: **Taxi Booking Platform**).
- Loki API: `http://localhost:3100`.

Các cổng pgAdmin, Prometheus, Grafana và Loki chỉ bind vào `127.0.0.1`. API quản trị yêu cầu thông tin Basic Auth trong `.env`; đặt xe vẫn dùng endpoint tạo chuyến công khai. Prometheus thu thập metrics từ chính nó, Node Exporter, cAdvisor, PostgreSQL Exporter và endpoint `/metrics` nội bộ của ứng dụng. Grafana tự cấu hình datasource Prometheus và Loki khi khởi động. Metrics cAdvisor và log Promtail được giới hạn vào Compose project `taxi-booking`.

## Ví dụ truy vấn LogQL

```logql
{container_name="taxi-web-app"}
{container_name="taxi-web-app"} |= "API Error"
{container_name=~"taxi-web-app|postgres-db"}
```

## Lưu ý bảo mật

- Container Express chạy bằng user không đặc quyền `node` và không publish cổng ứng dụng ra host.
- PostgreSQL không publish cổng ra host; chỉ các dịch vụ trong mạng backend mới truy cập được.
- Nginx xử lý TLS, ẩn phiên bản máy chủ và thiết lập các security header cho trình duyệt.
- Mật khẩu database và tài khoản quản trị được truyền qua `.env`; file này được Git bỏ qua.
- API quản trị yêu cầu tài khoản riêng qua HTTP Basic Auth; không tái sử dụng mật khẩu pgAdmin hoặc Grafana.
- Promtail cần truy cập Docker socket để phát hiện và thu thập log container. Quyền này rất cao, chỉ nên cấp trên máy chủ đáng tin cậy.
- cAdvisor đọc metadata filesystem của host và Docker để thu thập metrics container. Hạn chế quyền truy cập host và mạng monitoring của dịch vụ này.
- Trên Windows với Docker Desktop, Node Exporter quan sát Linux VM của Docker Desktop, không phải toàn bộ metrics của Windows host.
- cAdvisor cần quyền cao để đọc metrics container. Các dashboard đã lọc theo project, nhưng cần đánh giá lại quyền truy cập host trước khi chạy trên môi trường nhiều tenant hoặc production.
