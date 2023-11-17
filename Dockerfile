FROM golang:1.21-alpine AS build

RUN apk add --update --no-cache git ca-certificates build-base

COPY go.mod go.sum /app/
WORKDIR /app
RUN go mod download

COPY . /app/

RUN CGO_ENABLED=1 go build -a --tags timetzdata -ldflags '-linkmode external -extldflags "-static"' -o garoo-app .

FROM scratch

COPY --from=build /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
COPY --from=build /app/garoo-app /app/garoo

WORKDIR /app

CMD [ "./garoo" ]
