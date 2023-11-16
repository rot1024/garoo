package garoo

import "log/slog"

type Handler func(*Message, Receiver)

type Receiver interface {
	Name() string
	AddHandler(Handler)
	PostMessage(string, bool) error
	Start() error
	Stop() error
	SaveConfig(any) error
	LoadConfig(any) error
}

type MockReceiver struct {
	NameFunc        func() string
	AddHandlerFunc  func(Handler)
	PostMessageFunc func(string, bool) error
	StartFunc       func() error
	StopFunc        func() error
	SaveConfigFunc  func(any) error
	LoadConfigFunc  func(any) error
}

var _ Receiver = (*MockReceiver)(nil)

func (r *MockReceiver) Name() string {
	return r.NameFunc()
}

func (r *MockReceiver) AddHandler(h Handler) {
	r.AddHandlerFunc(h)
}

func (r *MockReceiver) PostMessage(msg string, mentionToUser bool) error {
	return r.PostMessageFunc(msg, mentionToUser)
}

func (r *MockReceiver) Start() error {
	return r.StartFunc()
}

func (r *MockReceiver) Stop() error {
	return r.StopFunc()
}

func (r *MockReceiver) SaveConfig(config any) error {
	return r.SaveConfigFunc(config)
}

func (r *MockReceiver) LoadConfig(config any) error {
	return r.LoadConfigFunc(config)
}

func postMessage(rec Receiver, content string) {
	if err := rec.PostMessage("unknown command", false); err != nil {
		slog.Error("failed to post message", "err", err)
	}
}
