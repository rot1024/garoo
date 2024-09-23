package twitter

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestX_ExtractSeed(t *testing.T) {
	tests := []struct {
		name string
		url  string
		want bool
	}{
		{
			name: "twitter",
			url:  "https://twitter.com/user/status/1234567890",
			want: true,
		},
		{
			name: "x",
			url:  "https://x.com/user/status/1234567890?query",
			want: true,
		},
		{
			name: "invalid",
			url:  "https://x.com/status",
			want: false,
		},
		{
			name: "invalid2",
			url:  "https://x.com/status/1234567890/1234567890",
			want: false,
		},
	}

	x := &Provider{}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			actual := x.Check(tt.url)
			assert.Equal(t, tt.want, actual)
		})
	}
}
