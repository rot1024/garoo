package twitter

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/samber/lo"
)

type Cookie struct {
	Name       string        `json:"name"`
	Value      string        `json:"value"`
	Path       string        `json:"path,omitempty"`       // optional
	Domain     string        `json:"domain,omitempty"`     // optional
	Expires    time.Time     `json:"expires,omitempty"`    // optional
	RawExpires string        `json:"rawExpires,omitempty"` // for reading cookies only
	MaxAge     int           `json:"maxAge"`
	Secure     bool          `json:"secure,omitempty"`
	HttpOnly   bool          `json:"httpOnly,omitempty"`
	SameSite   http.SameSite `json:"sameSite"`
	Raw        string        `json:"raw,omitempty"`
	Unparsed   []string      `json:"unparsed,omitempty"` // Raw text of unparsed attribute-value pairs
}

func NewCookie(c *http.Cookie) *Cookie {
	return (*Cookie)(c)
}

func (c *Cookie) ToHTTPCookie() *http.Cookie {
	return (*http.Cookie)(c)
}

func marshalCookies(cookies []*http.Cookie) string {
	cookies2 := lo.Map(cookies, func(c *http.Cookie, _ int) *Cookie {
		return NewCookie(c)
	})

	json, _ := json.Marshal(cookies2)
	return string(json)
}

func unmarshalCookies(j string) []*http.Cookie {
	var cookies []*Cookie
	_ = json.Unmarshal([]byte(j), &cookies)

	return lo.Map(cookies, func(c *Cookie, _ int) *http.Cookie {
		return c.ToHTTPCookie()
	})
}
