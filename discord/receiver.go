package discord

import (
	"encoding/json"
	"fmt"
	"slices"
	"strings"

	"github.com/bwmarrin/discordgo"
	"github.com/rot1024/garoo/garoo"
	"github.com/samber/lo"
)

const receiver = "discord"
const configPrefix = "CONFIG: "

type Receiver struct {
	session   *discordgo.Session
	channelID string
	userID    string
}

type Config struct {
	Token     string `json:"token"`
	ChannelID string `json:"channelId"`
	UserID    string `json:"userId"`
}

var _ garoo.Receiver = (*Receiver)(nil)

func New(config Config) (*Receiver, error) {
	session, err := discordgo.New("Bot " + config.Token)
	if err != nil {
		return nil, fmt.Errorf("failed to init discord: %v", err)
	}

	return &Receiver{
		session:   session,
		channelID: config.ChannelID,
		userID:    config.UserID,
	}, nil
}

func (d *Receiver) Name() string {
	return receiver
}

func (d *Receiver) AddHandler(h garoo.Handler) {
	d.session.AddHandler(func(s *discordgo.Session, m *discordgo.MessageCreate) {
		if m.Author.ID == s.State.User.ID || m.ChannelID != d.channelID {
			return
		}

		h(&garoo.Message{
			ID:        m.ID,
			Timestamp: m.Timestamp,
			Content:   m.Content,
		}, d)
	})
}

func (d *Receiver) PostMessage(msg string, mentionToUser bool) error {
	if mentionToUser && d.userID != "" {
		msg = fmt.Sprintf("<@%s> %s", d.userID, msg)
	}

	_, err := d.session.ChannelMessageSend(d.channelID, msg)
	if err != nil {
		return fmt.Errorf("failed to send message: %v", err)
	}
	return nil
}

func (d *Receiver) Start() error {
	if err := d.session.Open(); err != nil {
		return fmt.Errorf("failed to open session: %v", err)
	}
	return nil
}

func (d *Receiver) Stop() error {
	if err := d.session.Close(); err != nil {
		return fmt.Errorf("failed to close session: %v", err)
	}
	return nil
}

func (d *Receiver) SaveConfig(config any) error {
	confj, err := json.Marshal(config)
	if err != nil {
		return fmt.Errorf("failed to marshal config: %v", err)
	}

	content := configPrefix + string(confj)
	messages, err := d.getConfigMessages()
	if err != nil {
		return fmt.Errorf("failed to get config messages: %v", err)
	}

	msg, err := d.session.ChannelMessageSend(d.channelID, content)
	if err != nil {
		return fmt.Errorf("failed to send message: %v", err)
	}

	if err := d.session.ChannelMessagePin(d.channelID, msg.ID); err != nil {
		return fmt.Errorf("failed to pin message: %v", err)
	}

	// remove old config messages
	for _, m := range messages {
		if err := d.session.ChannelMessageDelete(d.channelID, m.ID); err != nil {
			return fmt.Errorf("failed to delete message: %v", err)
		}
	}

	return nil
}

func (d *Receiver) LoadConfig(config any) error {
	messages, err := d.getConfigMessages()
	if err != nil {
		return fmt.Errorf("failed to get config messages: %v", err)
	}

	if len(messages) == 0 {
		return nil
	}

	configj := strings.TrimPrefix(messages[0].Content, configPrefix)
	if err := json.Unmarshal([]byte(configj), config); err != nil {
		return fmt.Errorf("failed to unmarshal config: %v", err)
	}

	return nil
}

func (d *Receiver) getConfigMessages() ([]*discordgo.Message, error) {
	messages, err := d.session.ChannelMessagesPinned(d.channelID)
	if err != nil {
		return nil, fmt.Errorf("failed to get pinned messages: %v", err)
	}

	messages = lo.Filter(messages, func(m *discordgo.Message, _ int) bool {
		return strings.HasPrefix(m.Content, configPrefix)
	})

	slices.SortFunc(messages, func(a, b *discordgo.Message) int {
		return b.Timestamp.Compare(a.Timestamp)
	})

	return messages, nil
}
