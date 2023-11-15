package garoo

type Handler func(*Message, Receiver)

type Receiver interface {
	Name() string
	AddHandler(Handler)
	PostMessage(string) error
	Start() error
	Stop() error
}

type MockReceiver struct {
	NameFunc        func() string
	AddHandlerFunc  func(Handler)
	PostMessageFunc func(string) error
	StartFunc       func() error
	StopFunc        func() error
}

var _ Receiver = (*MockReceiver)(nil)

func (r *MockReceiver) Name() string {
	return r.NameFunc()
}

func (r *MockReceiver) AddHandler(h Handler) {
	r.AddHandlerFunc(h)
}

func (r *MockReceiver) PostMessage(msg string) error {
	return r.PostMessageFunc(msg)
}

func (r *MockReceiver) Start() error {
	return r.StartFunc()
}

func (r *MockReceiver) Stop() error {
	return r.StopFunc()
}
