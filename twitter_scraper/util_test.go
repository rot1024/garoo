package twitter_scraper

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestGetScreennameFromPath(t *testing.T) {
	assert.Equal(t, "hogehoge", getScreennameFromPath("/hogehoge/status/xxxx/photo/1"))
	assert.Equal(t, "", getScreennameFromPath("/hogehoge/"))
}

func TestFormatOGTitle(t *testing.T) {
	assert.Equal(t, "〜\n〜\n〜", formatOGTitle("Xユーザーのhogehogeさん: 「〜\n〜\n〜」 / X"))
	assert.Equal(t, "〜\n〜\n〜", formatOGTitle("Xユーザーのhogehogeさん: 「〜\n〜\n〜」 / Twitter"))
	assert.Equal(t, "〜〜〜", formatOGTitle("Xユーザーのhogehogeさん: 「〜〜〜」"))

	assert.Equal(t, "〜\n〜\n〜", formatOGTitle("hogehoge on X: \"〜\n〜\n〜\""))
	assert.Equal(t, "〜\n〜\n〜", formatOGTitle("hogehoge on Twitter: \"〜\n〜\n〜\""))
}
