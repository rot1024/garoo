package twitter_scraper

import "context"

type Logger = func(format string, v ...interface{})

type key struct{}

func logf(ctx context.Context, format string, v ...interface{}) {
	if logger, ok := ctx.Value(key{}).(Logger); ok {
		logger("twitter_scraper: "+format, v...)
	}
}

func SetLogger(ctx context.Context, logger Logger) context.Context {
	return context.WithValue(ctx, key{}, logger)
}
