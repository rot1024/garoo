package twitter

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/chromedp/cdproto/cdp"
	"github.com/chromedp/chromedp"
)

const shortTimeout = time.Millisecond * 500
const longTimeout = time.Second

func tasks(id, screenname string, post *Post) chromedp.Tasks {
	url := fmt.Sprintf("https://x.com/%s/status/%s", screenname, id)

	return chromedp.Tasks{
		chromedp.ActionFunc(func(ctx context.Context) error {
			logf(ctx, "post: go to %s", url)
			return nil
		}),
		chromedp.Navigate(url),
		chromedp.ActionFunc(func(ctx context.Context) error {
			logf(ctx, "post: waiting for tweet")
			return nil
		}),
		chromedp.WaitVisible(`time`, chromedp.ByQuery),
		chromedp.ActionFunc(func(ctx context.Context) error {
			post.ID = id
			post.URL = url
			return nil
		}),
		// text
		chromedp.AttributeValue(`meta[property="og:title"]`, "content", &post.Text, nil, chromedp.ByQuery),
		chromedp.ActionFunc(func(ctx context.Context) error {
			post.Text = formatOGTitle(post.Text)
			return nil
		}),
		// chromedp.TextContent(`[data-testid=tweetText]`, &post.Text, chromedp.ByQuery),
		// time
		chromedp.ActionFunc(getTime(&post.Time)),
		// photos
		chromedp.ActionFunc(getPhotos(&post.Photos, screenname)),
		// videos TODO
		getVideos(&post.Videos),
		// check
		chromedp.ActionFunc(func(ctx context.Context) error {
			if post.ID == "" || post.URL == "" || post.Time == "" {
				getLogger(ctx)("twitter: some info are missing: post=%#v", post)
				return ErrInvalidPost
			}
			return nil
		}),
		// profile
		getProfile(screenname, &post.Autor),
	}
}

func getTime(res *string) chromedp.ActionFunc {
	return func(ctx context.Context) error {
		// get first article
		nodes := []*cdp.Node{}
		if err := getNodesWithTimeout(ctx, `[data-testid=tweet]`, &nodes, shortTimeout, chromedp.ByQuery); err != nil {
			return fmt.Errorf("time: could not get article nodes: %w", err)
		}

		if len(nodes) == 0 {
			return errors.New("time: no article nodes")
		}

		// get last time
		nodes2 := []*cdp.Node{}
		if err := getNodesWithTimeout(ctx, `time`, &nodes2, shortTimeout, chromedp.ByQueryAll, chromedp.FromNode(nodes[0])); err != nil {
			return fmt.Errorf("time: could not get time nodes: %w", err)
		}

		if len(nodes2) == 0 {
			return errors.New("time: no time nodes")
		}

		*res = nodes2[len(nodes2)-1].AttributeValue("datetime")
		return nil
	}
}

func getPhotos(photos *[]string, screenname string) chromedp.ActionFunc {
	return func(ctx context.Context) error {
		var nodes []*cdp.Node

		// check if this tweet is quoted
		if err := getNodesWithTimeout(ctx, `a:has([data-testid=tweetPhoto] img)`, &nodes, shortTimeout, chromedp.ByQuery); err != nil {
			return fmt.Errorf("could not get quoted tweet nodes: %w", err)
		}

		if len(nodes) > 0 {
			href := nodes[0].AttributeValue("href")
			if !strings.Contains(href, "/photo/") {
				// invalid link
				logf(ctx, "invalid quoted tweet link: %s", href)
				return nil
			}

			author := getScreennameFromPath(href)
			if author == "" {
				// invalid link
				logf(ctx, "invalid quoted tweet link: %s", href)
				return nil
			}

			if !strings.EqualFold(author, screenname) {
				// quanted tweet
				logf(ctx, "quoted tweet: %s != %s", author, screenname)
				return nil
			}
		}

		nodes = nil
		if err := getNodesWithTimeout(ctx, `[data-testid=tweetPhoto] img`, &nodes, longTimeout, chromedp.ByQueryAll); err != nil {
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
		if err := getNodesWithTimeout(ctx, `[data-testid=videoPlayer]`, &nodes, longTimeout, chromedp.ByQueryAll); err != nil {
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
		MainEntity struct {
			Identifier     string `json:"identifier"`
			GivenName      string `json:"givenName"`
			AdditionalName string `json:"additionalName"`
			Description    string `json:"description"`
			Image          struct {
				ContentURL string `json:"contentUrl"`
			} `json:"image"`
		} `json:"mainEntity"`
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
			profile.Name = p.MainEntity.GivenName
			if profile.Name == "" {
				profile.Name = p.MainEntity.AdditionalName
			}
			profile.ID = p.MainEntity.Identifier
			profile.Avator = p.MainEntity.Image.ContentURL
			profile.Description = p.MainEntity.Description

			// check
			if profile.ID == "" || profile.Name == "" || profile.Screename == "" || profile.URL == "" {
				getLogger(ctx)("twitter: some info are missing: profile=%#v, json=%s", profile, rawJSON)
				return ErrInvalidPost
			}

			return nil
		}),
	}
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
