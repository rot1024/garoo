package garoo

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestSeedFrom(t *testing.T) {
	seed1 := SeedFrom("1234567890", "twitter", "hoge category tag1 tag2")
	assert.Equal(t, Seed{
		ID:       "1234567890",
		Provider: "twitter",
		Category: "category",
		Tags:     []string{"tag1", "tag2"},
	}, seed1)

	seed2 := SeedFrom("1234567890", "twitter", "hoge")
	assert.Equal(t, Seed{
		ID:       "1234567890",
		Provider: "twitter",
	}, seed2)

	seed3 := SeedFrom("1234567890", "twitter", "hoge -")
	assert.Equal(t, Seed{
		ID:       "1234567890",
		Provider: "twitter",
	}, seed3)

	seed4 := SeedFrom("1234567890", "twitter", "hoge - tag1 tag2")
	assert.Equal(t, Seed{
		ID:       "1234567890",
		Provider: "twitter",
		Tags:     []string{"tag1", "tag2"},
	}, seed4)
}
