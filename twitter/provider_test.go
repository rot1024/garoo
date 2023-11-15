package twitter

import (
	"net/url"
	"testing"

	"github.com/samber/lo"
	"github.com/stretchr/testify/assert"
)

func TestX_ExtractSeed(t *testing.T) {
	tests := []struct {
		name string
		url  string
		want string
	}{
		{
			name: "twitter",
			url:  "https://twitter.com/user/status/1234567890",
			want: "1234567890",
		},
		{
			name: "x",
			url:  "https://x.com/user/status/1234567890?query",
			want: "1234567890",
		},
		{
			name: "invalid",
			url:  "https://x.com/status",
			want: "",
		},
		{
			name: "invalid2",
			url:  "https://x.com/status/1234567890/1234567890",
			want: "",
		},
	}

	x := &Provider{}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			actual := x.ExtractPostID(lo.Must(url.Parse(tt.url)))
			assert.Equal(t, tt.want, actual)
		})
	}
}
