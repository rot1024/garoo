package main

import (
	"fmt"

	"github.com/rot1024/garoo/garoo"
)

var stores = map[string]func(*Config) (garoo.Store, error){}

func initStores(conf *Config) (res []garoo.Store, _ error) {
	for name, init := range stores {
		store, err := init(conf)
		if err != nil {
			return nil, fmt.Errorf("failed to init store %s: %v", name, err)
		}
		if store != nil {
			res = append(res, store)
		}
	}

	return
}
