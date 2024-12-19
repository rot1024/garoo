package twitter

import (
	"context"
	"errors"
	"net/url"
	"strings"
	"time"

	"github.com/chromedp/chromedp"
)

var ErrInvalidURL = errors.New("invalid url")
var ErrInvalidPost = errors.New("invalid post")

const timeout = time.Minute

func InitChromeDP(ctx context.Context, logger Logger) (context.Context, context.CancelFunc) {
	opts := append(chromedp.DefaultExecAllocatorOptions[:],
		chromedp.DisableGPU,
		chromedp.NoSandbox,
		// https://github.com/microsoft/playwright/blob/0cdc7ee1a3b392d9ab37618e2ee32bc1b929caa3/packages/playwright-core/src/server/deviceDescriptorsSource.json
		chromedp.UserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.6723.6 Safari/537.36"),
	)

	ctx = SetLogger(ctx, logger)
	ctx2, cancel := chromedp.NewExecAllocator(ctx, opts...)
	return ctx2, cancel
}

func GetPostFromURL(ctx context.Context, url string) (*Post, error) {
	id, screenname := getIDAndScreenNameFromURL(url)
	if id == "" || screenname == "" {
		return nil, ErrInvalidURL
	}

	return GetPost(ctx, id, screenname)
}

func GetPost(ctx context.Context, id, screenname string) (*Post, error) {
	if id == "" || screenname == "" {
		return nil, ErrInvalidURL
	}

	opts := []chromedp.ContextOption{}
	if logger := getLogger(ctx); logger != nil {
		opts = append(opts, chromedp.WithLogf(logger))
	}

	ctx2, cancel := chromedp.NewContext(ctx, opts...)
	defer cancel()

	ctx3, cancel := context.WithTimeout(ctx2, timeout)
	defer cancel()

	post := &Post{}
	tasks := tasks(id, screenname, post)
	if err := chromedp.Run(ctx3, tasks); err != nil {
		return nil, err
	}

	if !checkPost(post) {
		return nil, ErrInvalidPost
	}

	return post, nil
}

func checkPost(p *Post) bool {
	return p.URL != "" && p.ID != "" && p.Time != "" && p.Autor.ID != "" && p.Autor.Name != "" && p.Autor.Screename != "" && p.Autor.URL != ""
}

func getIDAndScreenNameFromURL(u string) (string, string) {
	u2, err := url.Parse(u)
	if err != nil {
		return "", ""
	}

	if u2.Host != "twitter.com" && u2.Host != "x.com" {
		return "", ""
	}

	path := strings.Split(u2.Path, "/")
	if len(path) < 3 || path[2] != "status" {
		return "", ""
	}

	return path[3], path[1]
}
