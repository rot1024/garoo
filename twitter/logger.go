package twitter

import "context"

type Logger = func(format string, v ...any)

var DefaultLogger Logger = func(format string, v ...any) {}

type key struct{}

func logf(ctx context.Context, format string, v ...any) {
	if logger := getLogger(ctx); logger != nil {
		logger("twitter_scraper: "+format, v...)
	}
}

func SetLogger(ctx context.Context, logger Logger) context.Context {
	return context.WithValue(ctx, key{}, logger)
}

func getLogger(ctx context.Context) Logger {
	if logger, ok := ctx.Value(key{}).(Logger); ok {
		return logger
	}
	return DefaultLogger
}
