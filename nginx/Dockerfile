FROM alpine AS BUILDER
WORKDIR /sources
RUN wget -qO- https://nginx.org/download/nginx-1.25.3.tar.gz | tar zxf -
RUN wget -qO- https://github.com/evanmiller/mod_zip/archive/refs/tags/1.3.0.tar.gz | tar zxf -
WORKDIR /sources/nginx-1.25.3
RUN apk add build-base pcre-dev zlib-dev
RUN ./configure --with-compat --add-dynamic-module=/sources/mod_zip-1.3.0
RUN make modules

FROM nginx:1.25.3-alpine
COPY --from=BUILDER /sources/nginx-1.25.3/objs/ngx_http_zip_module.so /etc/nginx/modules/
COPY default.conf.template /etc/nginx/templates/default.conf.template
COPY nginx.conf /etc/nginx/nginx.conf
