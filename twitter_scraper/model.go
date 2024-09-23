package twitter_scraper

type Post struct {
	URL    string
	ID     string
	Text   string
	Autor  Profile
	Time   string
	Photos []string
	Videos []string
}

type Profile struct {
	URL         string
	Screename   string
	Name        string
	ID          string
	Avator      string
	Description string
}
