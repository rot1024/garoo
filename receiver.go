package main

import (
	"fmt"

	"github.com/rot1024/garoo/discord"
	"github.com/rot1024/garoo/garoo"
)

var receivers = map[string]func(*Config) (garoo.Receiver, error){
	"discord": initDiscord,
}

func initReceivers(conf *Config) (res []garoo.Receiver, _ error) {
	for name, init := range receivers {
		receiver, err := init(conf)
		if err != nil {
			return nil, fmt.Errorf("failed to init receiver %s: %v", name, err)
		}
		if res == nil {
			res = append(res, receiver)
		}
	}

	return
}

func initDiscord(conf *Config) (garoo.Receiver, error) {
	if conf.Discord.Token == "" {
		return nil, fmt.Errorf("token is empty")
	}

	return discord.New(conf.Discord.Token)
}
