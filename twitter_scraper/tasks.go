package twitter_scraper

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"path"
	"strings"
	"time"

	"github.com/chromedp/cdproto/cdp"
	"github.com/chromedp/chromedp"
)

func tasks(id, screename string, post *Post) chromedp.Tasks {
	url := fmt.Sprintf("https://x.com/%s/status/%s", screename, id)

	return chromedp.Tasks{
		chromedp.ActionFunc(func(ctx context.Context) error {
			logf(ctx, "post: go to %s", url)
			return nil
		}),
		chromedp.Navigate(url),
		chromedp.WaitVisible(`[data-testid=tweetText]`, chromedp.ByQuery),
		chromedp.ActionFunc(func(ctx context.Context) error {
			post.ID = id
			post.URL = url
			return nil
		}),
		// text
		chromedp.AttributeValue(`meta[property="og:title"]`, "content", &post.Text, nil, chromedp.ByQuery),
		chromedp.ActionFunc(func(ctx context.Context) error {
			if strings.HasSuffix(post.Text, " / X") {
				post.Text = strings.TrimSuffix(post.Text, " / X")
			} else {
				post.Text = strings.TrimSuffix(post.Text, " / Twitter")
			}
			return nil
		}),
		// chromedp.TextContent(`[data-testid=tweetText]`, &post.Text, chromedp.ByQuery),
		// time
		chromedp.AttributeValue(`time`, "datetime", &post.Time, nil, chromedp.ByQuery),
		// photos
		chromedp.ActionFunc(getPhotos(&post.Photos)),
		// videos TODO
		getVideos(&post.Videos),
		// profile
		getProfile(screename, &post.Autor),
	}
}

func getPhotos(photos *[]string) chromedp.ActionFunc {
	return func(ctx context.Context) error {
		var nodes []*cdp.Node

		if err := getNodesWithTimeout(ctx, `[data-testid=tweetPhoto] img`, &nodes, time.Second, chromedp.ByQueryAll); err != nil {
			return fmt.Errorf("could not get photo nodes: %w", err)
		}

		for _, node := range nodes {
			src := node.AttributeValue("src")
			if src == "" || strings.Contains(src, "ext_tw_video_thumb") {
				continue
			}

			large, err := fixPhotoURL(src)
			if err != nil {
				return fmt.Errorf("could not get large photo: %w", err)
			}

			*photos = append(*photos, large)
		}
		return nil
	}
}

func getVideos(_ *[]string) chromedp.ActionFunc {
	return chromedp.ActionFunc(func(ctx context.Context) error {
		nodes := []*cdp.Node{}
		if err := getNodesWithTimeout(ctx, `[data-testid=videoPlayer]`, &nodes, time.Second, chromedp.ByQueryAll); err != nil {
			return fmt.Errorf("could not get video nodes: %w", err)
		}

		if len(nodes) == 0 {
			return nil
		}

		logf(ctx, "%d videos", len(nodes))

		// for _, node := range nodes {
		// 	url, err := waitForVideo(ctx, node)
		// 	if err != nil {
		// 		return fmt.Errorf("could not wait for video: %w", err)
		// 	}

		// 	logf(ctx, "video: %s", url)
		// 	*videos = append(*videos, url)
		// }

		// return nil

		return errors.New("video not implemented")
	})
}

// func waitForVideo(ctx context.Context, node *cdp.Node) (string, error) {
// 	ctx2, cancel := context.WithCancel(ctx)
// 	defer cancel()

// 	ch := make(chan string)
// 	chromedp.ListenTarget(ctx2, func(ev interface{}) {
// 		if ev, ok := ev.(*network.EventRequestWillBeSent); ok {
// 			url := ev.Request.URL
// 			if !strings.Contains(url, "video.twimg.com") {
// 				return
// 			}

// 			go func() {
// 				logf(ctx, "req: %s", url)
// 				ch <- url
// 			}()
// 		}
// 	})

// 	logf(ctx, "click video")
// 	if err := chromedp.MouseClickNode(node).Do(ctx); err != nil {
// 		return "", fmt.Errorf("could not click video: %w", err)
// 	}

// 	logf(ctx, "waiting for video")

// 	select {
// 	case <-time.After(10 * time.Second):
// 		return "", fmt.Errorf("timeout")
// 	case url := <-ch:
// 		return url, nil
// 	}
// }

func getProfile(screename string, profile *Profile) chromedp.Tasks {
	url := fmt.Sprintf("https://x.com/%s", screename)
	rawJSON := ""

	type profileJSON struct {
		Author struct {
			Identifier     string `json:"identifier"`
			AdditionalName string `json:"additionalName"`
			Description    string `json:"description"`
			Image          struct {
				ContentURL string `json:"contentUrl"`
			} `json:"image"`
		} `json:"author"`
	}

	return chromedp.Tasks{
		chromedp.ActionFunc(func(ctx context.Context) error {
			logf(ctx, "profile: go to %s", url)
			return nil
		}),
		chromedp.Navigate(url),
		chromedp.WaitVisible(`[data-testid=UserName]`, chromedp.ByQuery),
		chromedp.TextContent(`[data-testid=UserProfileSchema-test]`, &rawJSON, chromedp.ByQuery),
		chromedp.ActionFunc(func(ctx context.Context) error {
			p := profileJSON{}
			if err := json.Unmarshal([]byte(rawJSON), &p); err != nil {
				return fmt.Errorf("could not unmarshal profile json: %w", err)
			}

			profile.URL = url
			profile.Screename = screename
			profile.Name = p.Author.AdditionalName
			profile.ID = p.Author.Identifier
			profile.Avator = p.Author.Image.ContentURL
			profile.Description = p.Author.Description
			return nil
		}),
	}
}

func fixPhotoURL(u string) (string, error) {
	u2, err := url.Parse(u)
	if err != nil {
		return "", fmt.Errorf("could not parse url: %w", err)
	}

	q := u2.Query()
	// notion returns an error if the path does not have an extension
	if format := q.Get("format"); format != "" {
		if path.Ext(u2.Path) == "" {
			u2.Path += "." + format
		}
	}

	u2.RawQuery = ""
	return u2.String(), nil
}

// func logHTML(ctx context.Context) error {
// 	var html string
// 	if err := chromedp.OuterHTML("html", &html).Do(ctx); err != nil {
// 		return fmt.Errorf("could not get HTML: %w", err)
// 	}
// 	logf(ctx, "HTML: %s", html)
// 	return nil
// }

func getNodesWithTimeout(ctx context.Context, sel any, nodes *[]*cdp.Node, d time.Duration, opts ...chromedp.QueryOption) error {
	tctx, cancel := context.WithTimeout(ctx, d)
	defer cancel()

	// if timeout was exceeded, return nil
	if err := chromedp.Nodes(sel, nodes, opts...).Do(tctx); err != nil {
		if ctx.Err() == context.DeadlineExceeded {
			return nil
		}
	}

	return nil
}
