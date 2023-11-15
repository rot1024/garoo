package main

import (
	"fmt"

	"github.com/joho/godotenv"
	"github.com/kelseyhightower/envconfig"
)

const CONFIG_PREFIX = "GAROO"

type Config struct {
	Discord DiscordConfig `json:"discord"`
	Twitter TwitterConfig `json:"twitter"`
	SQLite  SQLiteConfig  `json:"sqlite"`
}

type DiscordConfig struct {
	Token string `json:"token"`
}

type TwitterConfig struct {
	User     string `json:"user"`
	Password string `json:"password"`
	Email    string `json:"email"`
}

type SQLiteConfig struct {
	DSN string `json:"dsn"`
}

func LoadConfig() (*Config, error) {
	// load .env
	err := godotenv.Load()
	if err != nil {
		return nil, fmt.Errorf("failed to load .env: %v", err)
	}

	// load config
	config := &Config{}
	err = envconfig.Process(CONFIG_PREFIX, config)
	if err != nil {
		return nil, fmt.Errorf("failed to load config: %v", err)
	}

	return config, nil
}
