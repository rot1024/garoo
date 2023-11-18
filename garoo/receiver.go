package garoo

type Handler func(*Message, Receiver)

type Receiver interface {
	Name() string
	AddHandler(Handler)
	PostMessage(PostMessageRequest) error
	Start() error
	Stop() error
	SaveConfig(any) error
	LoadConfig(any) error
}

type PostMessageRequest struct {
	Message        string
	MentionToUser  bool
	ReplyToMessage string
}

type MockReceiver struct {
	NameFunc        func() string
	AddHandlerFunc  func(Handler)
	PostMessageFunc func(PostMessageRequest) error
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

func (r *MockReceiver) PostMessage(req PostMessageRequest) error {
	return r.PostMessageFunc(req)
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
