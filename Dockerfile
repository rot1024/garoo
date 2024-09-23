FROM golang:1.21 AS build

COPY go.mod go.sum /app/
WORKDIR /app
RUN go mod download

COPY . /app/

RUN go build --tags timetzdata -o garoo-app .

FROM chromedp/headless-shell:latest

COPY --from=build /app/garoo-app /app/garoo

WORKDIR /app

CMD [ "/app/garoo" ]
