package twitter_scraper

import (
	"fmt"
	"net/url"
	"path"
	"regexp"
	"strings"
)

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

var reJaTitle = regexp.MustCompile(`(?s)^.*さん: 「(.*)」$`)
var reEnTitle = regexp.MustCompile(`(?s)^.* on X: "(.*)"$`)
var reEnTitle2 = regexp.MustCompile(`(?s)^.* on Twitter: "(.*)"$`)

func formatOGTitle(title string) string {
	if strings.HasSuffix(title, " / X") {
		title = strings.TrimSuffix(title, " / X")
	} else {
		title = strings.TrimSuffix(title, " / Twitter")
	}

	if m := reJaTitle.FindStringSubmatch(title); len(m) == 2 {
		return m[1]
	} else if m = reEnTitle.FindStringSubmatch(title); len(m) == 2 {
		return m[1]
	} else if m = reEnTitle2.FindStringSubmatch(title); len(m) == 2 {
		return m[1]
	}

	return title
}
