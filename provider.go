package main

import (
	"fmt"

	"github.com/rot1024/garoo/garoo"
	"github.com/rot1024/garoo/twitter"
)

var providers = map[string]func(*Config) (garoo.Provider, error){
	"twitter": initTwitter,
}

func initProviders(conf *Config) (res []garoo.Provider, _ error) {
	for name, init := range providers {
		provider, err := init(conf)
		if err != nil {
			return nil, fmt.Errorf("failed to init provider %s: %v", name, err)
		}
		if provider != nil {
			res = append(res, provider)
		}
	}

	return
}

func initTwitter(conf *Config) (garoo.Provider, error) {
	return twitter.New()
}
