FROM node:20-alpine

# Tạo thư mục làm việc
WORKDIR /usr/src/app

# Sao chép file khai báo dependency
COPY package*.json ./

# Cài đặt dependency
RUN npm ci --omit=dev

# Sao chép mã nguồn
COPY . .

# HARDENING BẢO MẬT: Chuyển sang dùng user non-root 'node' có sẵn trong image alpine
USER node

EXPOSE 3000

CMD ["node", "server.js"]