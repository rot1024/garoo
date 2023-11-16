package twitter

import (
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestMarshalUnmarshalCookies(t *testing.T) {
	cookies := []*http.Cookie{
		{
			Name:   "foo",
			Value:  "bar",
			Domain: "example.com",
		},
		{
			Name:  "baz",
			Value: "qux",
		},
	}

	j := marshalCookies(cookies)
	cookies2 := unmarshalCookies(j)
	assert.Equal(t, cookies, cookies2)
}
