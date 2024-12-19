package twitter

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestRun(t *testing.T) {
	t.SkipNow()
	screenname := ""
	id := ""

	ctx, cancel := InitChromeDP(context.Background(), t.Logf)
	defer cancel()

	post, err := GetPost(ctx, id, screenname)

	assert.NoError(t, err)
	t.Logf("Post: %+v", post)
}

func TestGetIDAndScreenNameFromURL(t *testing.T) {
	id, screenname := getIDAndScreenNameFromURL("https://x.com/xxx/status/1111111111111")
	assert.Equal(t, "1111111111111", id)
	assert.Equal(t, "xxx", screenname)

	id, screenname = getIDAndScreenNameFromURL("https://twitter.com/xxx/status/1111111111111")
	assert.Equal(t, "1111111111111", id)
	assert.Equal(t, "xxx", screenname)

	id, screenname = getIDAndScreenNameFromURL("https://hoge.com/xxx/status/1111111111111")
	assert.Empty(t, id)
	assert.Empty(t, screenname)
}
