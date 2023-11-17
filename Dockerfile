FROM golang:1.21-alpine AS build

RUN apk add --update --no-cache git ca-certificates build-base

COPY go.mod go.sum /app/
WORKDIR /app
RUN go mod download

COPY . /app/

RUN go build --tags timetzdata -o garoo-app .

FROM alpine

COPY --from=build /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
COPY --from=build /app/garoo-app /app/garoo

RUN chomod a+rw /app

WORKDIR /app

CMD [ "./garoo" ]
