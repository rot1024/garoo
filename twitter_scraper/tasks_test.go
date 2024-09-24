package twitter_scraper

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestFormatOGTitle(t *testing.T) {
	assert.Equal(t, "〜\n〜\n〜", formatOGTitle("Xユーザーのhogehogeさん: 「〜\n〜\n〜」 / X"))
	assert.Equal(t, "〜\n〜\n〜", formatOGTitle("Xユーザーのhogehogeさん: 「〜\n〜\n〜」 / Twitter"))
	assert.Equal(t, "〜〜〜", formatOGTitle("Xユーザーのhogehogeさん: 「〜〜〜」"))
}
