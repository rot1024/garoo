package main

import (
	"fmt"

	"github.com/rot1024/garoo/garoo"
	"github.com/rot1024/garoo/sqlite"
)

var stores = map[string]func(*Config) (garoo.Store, error){
	"sqlite": initSQLite,
}

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

func initSQLite(conf *Config) (garoo.Store, error) {
	if conf.SQLite.DSN == "" {
		return nil, nil
	}
	return sqlite.New(conf.SQLite.DSN)
}
