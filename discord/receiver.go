package discord

import (
	"fmt"

	"github.com/bwmarrin/discordgo"
	"github.com/rot1024/garoo/garoo"
)

const receiver = "discord"

type Receiver struct {
	session *discordgo.Session
}

var _ garoo.Receiver = (*Receiver)(nil)

func New(token string) (*Receiver, error) {
	session, err := discordgo.New(token)
	if err != nil {
		return nil, fmt.Errorf("failed to init discord: %v", err)
	}

	return &Receiver{
		session: session,
	}, nil
}

func (d *Receiver) Name() string {
	return receiver
}

func (d *Receiver) AddHandler(h garoo.Handler) {
	d.session.AddHandler(func(s *discordgo.Session, m *discordgo.MessageCreate) {
		if m.Author.ID == s.State.User.ID {
			return
		}

		h(&garoo.Message{
			ID:        m.ID,
			Timestamp: m.Timestamp,
			Content:   m.Content,
			Username:  m.Author.Username,
		}, d)
	})
}

func (d *Receiver) PostMessage(msg string) error {
	_, err := d.session.ChannelMessageSend(d.session.State.User.ID, msg)
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
