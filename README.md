### root

`bun run start --hot`

### client

`bun run dev`


## deploy script (forge)

```
$CREATE_RELEASE()

cd $FORGE_RELEASE_DIRECTORY

bun install

bun run build

$ACTIVATE_RELEASE()
```

## environment variables

```
VITE_SERVER_PORT=2567
VITE_DOMAIN=bomber-birds.on-forge.com
VITE_SERVER_URL=https://bomber-birds.on-forge.com/colyseus/
VITE_WS_URL=wss://bomber-birds.on-forge.com/colyseus/
VITE_ORIGIN=https://bomber-birds.on-forge.com
COLYSEUS_PUBLIC_ADDRESS=bomber-birds.on-forge.com/colyseus
REDIS_URL=10.0.0.6
```

## nginx conf

```
ssl_protocols TLSv1.2 TLSv1.3;
ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-CHACHA20-POLY1305:ECDHE-RSA-CHACHA20-POLY1305:DHE-RSA-AES128-GCM-SHA256:DHE-RSA-AES256-GCM-SHA384;
ssl_prefer_server_ciphers off;
ssl_dhparam /etc/nginx/dhparams.pem;

add_header X-Frame-Options "SAMEORIGIN";
add_header X-XSS-Protection "1; mode=block";
add_header X-Content-Type-Options "nosniff";

index index.html index.htm;
charset utf-8;

# FORGE CONFIG (DO NOT REMOVE!)
include forge-conf/3062950/server/*;

# Colyseus game server — HTTP + WebSocket reverse proxy
location /colyseus/ {
    proxy_pass http://127.0.0.1:2567/;
    proxy_http_version 1.1;

    # WebSocket upgrade
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";

    # Pass real client info
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;

    # Timeouts for long-lived WebSocket connections
    proxy_read_timeout 86400s;
    proxy_send_timeout 86400s;
}

# Client static files (Vite build output in /public)
location / {
    try_files $uri $uri/ /index.html;
}

location = /favicon.ico { access_log off; log_not_found off; }
location = /favicon.svg { access_log off; log_not_found off; }
location = /robots.txt  { access_log off; log_not_found off; }

access_log off;
error_log /var/log/nginx/3062950-error.log error;

location ~ /\.(?!well-known).* {
    deny all;
}
```