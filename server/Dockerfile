# Etapa de compilación
FROM golang:1.27-alpine AS builder
WORKDIR /app
COPY go.mod ./
# Sin dependencias no hay go.sum. En cuanto entre la primera, hay que copiarlo aquí y
# descomentar el `go mod download`, o la imagen dejará de ser reproducible.
# COPY go.sum ./
# RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o nodo .

# Etapa final
FROM alpine:latest
RUN apk --no-cache add ca-certificates tzdata
WORKDIR /root/

# El nodo *envuelve* al agente, así que el binario de Claude Code y sus credenciales tienen
# que estar dentro. No se copian en la imagen: se montan desde la máquina (ver
# docker-compose.yml), porque son las credenciales OAuth de una persona y no pertenecen a
# ninguna imagen.
COPY --from=builder /app/nodo .
EXPOSE 8787
CMD ["./nodo"]
